import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Receipt, ReceiptKind } from '../types'

const PANE = 'hud-ledger'
// Bump a shape tag when that value's fields change: it declines what an
// earlier version stored, which outlives a reload.
const receipts = atom({ plugin: 'hud-ledger', key: 'receipts' } as const, [] as Receipt[], { shape: 'receipts-1' })
const flushed = atom({ plugin: 'hud-ledger', key: 'flushed' } as const, 0)
const dirty = atom({ plugin: 'hud-ledger', key: 'dirty' } as const, null as number | null)

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/
const PR_URL_RE = /https:\/\/github\.com\/[^\s"']+\/pull\/\d+/
const LINEAR_ID_RE = /"id"\s*:\s*"([A-Z][A-Z0-9]+-\d+)"/
const SLACK_LINK_RE = /"message_link"\s*:\s*"([^"]+)"/
const DOC_ID_RE = /"documentId"\s*:\s*"([^"]+)"/

type Args = Record<string, unknown>

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// Pure: what a finished tool call amounts to, or null when it isn't a receipt.
export function receiptFor(tool: string, args: Args, text: string, at: number): Receipt | null {
  const make = (kind: ReceiptKind, label: string, url?: string): Receipt => ({ at, kind, label, url })

  if (tool === 'Bash') {
    const command = str(args.command)
    if (/\bgh\s+pr\s+create\b/.test(command)) {
      const url = text.match(PR_URL_RE)?.[0]
      return make('pr', url ? 'opened ' + url.replace(/^.*\/pull\//, '#') : 'opened a PR', url)
    }
    if (/\bgh\s+pr\s+merge\b/.test(command)) {
      const n = command.match(/\bmerge\s+(\d+)/)?.[1]
      return make('merge', n ? 'merged #' + n : 'merged a PR')
    }
    if (/\bgws\s+docs\s+documents\s+batchUpdate\b/.test(command)) {
      const id = command.match(DOC_ID_RE)?.[1]
      return make('gdoc', 'edited a Google Doc', id ? 'https://docs.google.com/document/d/' + id + '/edit' : undefined)
    }
    if (/\bhud\s+sync\b/.test(command)) {
      return make('sync', 'hud sync')
    }
    return null
  }

  if (tool.endsWith('__save_issue')) {
    const id = text.match(LINEAR_ID_RE)?.[1] ?? str(args.id)
    const verb = str(args.id) ? 'updated ' : 'created '
    return make('linear', verb + (id || 'a Linear issue'), text.match(URL_RE)?.[0])
  }
  if (tool.endsWith('__save_comment')) {
    const on = str(args.issueId) || str(args.projectId) || 'Linear'
    return make('comment', 'commented on ' + on)
  }
  if (tool.endsWith('__slack_send_message') || tool.endsWith('__slack_schedule_message')) {
    const link = text.match(SLACK_LINK_RE)?.[1]?.replace(/\\\//g, '/')
    const verb = tool.endsWith('__slack_schedule_message') ? 'scheduled' : 'posted'
    return make('slack', verb + ' a Slack message', link)
  }
  return null
}

function hhmm(at: number): string {
  const d = new Date(at)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// Pure: the markdown body `hud new` writes for a batch of receipts.
export function noteBody(sessionId: string, batch: readonly Receipt[]): string {
  const rows = batch.map(r => '| ' + hhmm(r.at) + ' | ' + r.kind + ' | ' + r.label + ' | ' + (r.url ? '<' + r.url + '>' : '') + ' |')
  return [
    'Receipts captured by the hud-ledger mod from one Claude Code session.',
    '',
    'Session: `' + sessionId + '`',
    '',
    '| time | kind | what | link |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

async function storeKey($: EngineInterface): Promise<string> {
  return 'ledger:' + (await $.session.id())
}

async function persist($: EngineInterface): Promise<void> {
  await $.store.set(await storeKey($), { receipts: await read($, receipts), flushed: await read($, flushed) })
}

// The HUD root the `hud` CLI uses: $HUD_ROOT, else ~/hud.
async function hudRoot($: EngineInterface): Promise<string | undefined> {
  const configured = await $.env.get('HUD_ROOT')
  if (configured) return configured
  const home = await $.env.get('HOME')
  return home ? home + '/hud' : undefined
}

async function refreshDirty($: EngineInterface): Promise<void> {
  const root = await hudRoot($)
  if (!root) return
  try {
    const st = await $.process.run(['git', '-C', root, 'status', '--porcelain'], { timeoutMs: 10_000 })
    const n = st.exitCode === 0 ? st.stdout.split('\n').filter(Boolean).length : null
    await update($, dirty, () => n)
  } catch {
    await update($, dirty, () => null)
  }
}

async function flush($: EngineInterface): Promise<string> {
  const all = await read($, receipts)
  const done = await read($, flushed)
  const batch = all.slice(done)
  const first = batch[0]
  if (!first) return 'Nothing new to flush.'

  const root = await hudRoot($)
  if (!root) return 'No HUD root: set HUD_ROOT, or HOME so ~/hud resolves.'
  const sessionId = await $.session.id()
  const day = new Date(first.at).toISOString().slice(0, 10)
  const title = 'Session receipts ' + day + ' ' + hhmm(first.at).replace(':', '')
  let run
  try {
    run = await $.process.run(
      ['hud', 'new', 'inbox', '--title', title, '--summary', batch.length + ' receipts from a Claude Code session', '--body-file', '-'],
      { cwd: root, stdin: noteBody(sessionId, batch), timeoutMs: 30_000 },
    )
  } catch {
    return 'Could not run the `hud` CLI (is it on PATH?). Receipts are kept; nothing was flushed.'
  }
  if (run.exitCode !== 0) return 'hud new failed (exit ' + run.exitCode + '): ' + (run.stderr || run.stdout).trim().slice(0, 300)

  await update($, flushed, () => all.length)
  await persist($)
  const created = run.stdout.split('\n').find((l: string) => l.startsWith('created ')) ?? 'note written'
  return 'Flushed ' + batch.length + ' receipt(s): ' + created.trim() + '. Run `hud sync` to push.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Reload what this session already captured: $.store outlives reloads, resumes and restarts.
    const saved = (await $.store.get(await storeKey($))) as { receipts?: Receipt[]; flushed?: number } | undefined
    if (saved?.receipts) {
      await update($, receipts, () => saved.receipts ?? [])
      await update($, flushed, () => saved.flushed ?? 0)
    }
    void refreshDirty($)
    $.clock.every(60_000, async () => {
      await refreshDirty($)
    })
    try {
      await $.command.register({ name: 'hud', description: 'HUD ledger: status, open, or flush receipts into the HUD', argumentHint: '[status|open|flush]' })
    } catch {
      // A taken name refuses the registration; the hooks still capture.
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const receipt = receiptFor(e.tool, e as unknown as Args, ran.text ?? '', await $.clock.now())
    if (receipt) {
      await update($, receipts, list => [...list, receipt].slice(-500))
      await persist($)
      if (receipt.kind === 'sync') void refreshDirty($)
    }
    return ran
  })

  on('command.run', { command: 'hud' }, async ($, e) => {
    const arg = (e.args || 'status').trim()
    if (arg === 'open') {
      await $.ui.open({ id: PANE, title: 'HUD ledger' })
      return {}
    }
    if (arg === 'flush') {
      return { text: await flush($) }
    }
    await refreshDirty($)
    const all = await read($, receipts)
    const done = await read($, flushed)
    const d = await read($, dirty)
    return {
      text: all.length + ' receipt(s) this session, ' + (all.length - done) + ' not yet flushed; ' +
        (d === null ? 'HUD status unknown' : d + ' uncommitted change(s) in the HUD') + '.',
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, receipts)
    const done = await read($, flushed)
    const d = await read($, dirty)
    if (e.props.hasSurvey || (all.length === 0 && !d)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const pending = all.length - done
    return (
      <Box>
        <Text dimColor>
          HUD · {all.length} receipt{all.length === 1 ? '' : 's'}
          {pending > 0 ? ' (' + pending + ' unflushed)' : ''}
          {d ? ' · ' + d + ' uncommitted in HUD' : ''} · /hud
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, receipts)
    const done = await read($, flushed)
    const room = Math.max(1, (e.viewport?.rows ?? 24) - 3)
    return (
      <Box flexDirection="column">
        {all.length === 0 && <Text dimColor>No receipts yet this session.</Text>}
        {all.slice(-room).map((r, i) => (
          <Text dimColor={all.length - Math.min(all.length, room) + i < done}>
            {hhmm(r.at)} {r.kind.padEnd(7)} {r.label}
          </Text>
        ))}
      </Box>
    )
  })
}
