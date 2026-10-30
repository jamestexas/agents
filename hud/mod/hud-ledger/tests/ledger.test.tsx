import { expect, test } from 'claude-code/testing'

import { noteBody, receiptFor } from '../hooks/register.tsx'

test('receiptFor recognizes the calls worth a receipt', () => {
  const pr = receiptFor('Bash', { command: 'gh pr create --title x' }, 'https://github.com/example-org/example-repo/pull/123\n', 1)
  expect(pr).toEqual({ at: 1, kind: 'pr', label: 'opened #123', url: 'https://github.com/example-org/example-repo/pull/123' })

  expect(receiptFor('Bash', { command: 'gh pr merge 456 --squash' }, '', 1)?.label).toBe('merged #456')
  expect(receiptFor('Bash', { command: 'hud sync' }, 'committed 2 file(s)', 1)?.kind).toBe('sync')

  const doc = receiptFor('Bash', { command: `gws docs documents batchUpdate --params '{"documentId":"abc123"}'` }, '', 1)
  expect(doc?.url).toBe('https://docs.google.com/document/d/abc123/edit')

  const issue = receiptFor('mcp__plugin_linear_linear__save_issue', { team: 'ABC' }, '{"id":"ABC-101","url":"https://linear.app/x/issue/ABC-101"}', 1)
  expect(issue?.label).toBe('created ABC-101')
  expect(issue?.url).toBe('https://linear.app/x/issue/ABC-101')

  const update = receiptFor('mcp__plugin_linear_linear__save_issue', { id: 'ABC-102', state: 'Done' }, '{"id":"ABC-102"}', 1)
  expect(update?.label).toBe('updated ABC-102')

  const slack = receiptFor('mcp__plugin_slack_slack__slack_send_message', {}, '{"message_link":"https:\\/\\/x.slack.com\\/archives\\/C1\\/p1"}', 1)
  expect(slack?.url).toBe('https://x.slack.com/archives/C1/p1')

  expect(receiptFor('Bash', { command: 'ls' }, '', 1)).toBe(null)
  expect(receiptFor('Read', { file_path: 'a' }, '', 1)).toBe(null)
})

test('noteBody renders one table row per receipt', () => {
  const body = noteBody('sess-1', [{ at: 0, kind: 'pr', label: 'opened #1', url: 'https://github.com/o/r/pull/1' }])
  expect(body).toContain('Session: `sess-1`')
  expect(body).toContain('| pr | opened #1 | <https://github.com/o/r/pull/1> |')
})

test('a PR opened through Bash shows up in /hud and flushes via hud new', async ($, on) => {
  const ran: string[][] = []
  const mem = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: mem.get(e.key) }))
  on('store.set', ($, e) => {
    mem.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1793400000000 }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('env.get', ($, e) => ({ value: e.name === 'HUD_ROOT' ? '/data/hud' : '/home/x' }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: ' M a\n M b\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: 'created inbox/2026-01-01-session-receipts.md\n', stderr: '' } }
  })
  on('tool.call', () => ({ result: 'ok', text: 'https://github.com/example-org/example-repo/pull/42\n' }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })

  const status = await $.command.run({ command: 'hud', args: '' })
  expect(status.text).toBe('1 receipt(s) this session, 1 not yet flushed; 2 uncommitted change(s) in the HUD.')

  const flushed = await $.command.run({ command: 'hud', args: 'flush' })
  expect(flushed.text).toContain('Flushed 1 receipt(s): created inbox/2026-01-01-session-receipts.md')
  const hudCall = ran.find(argv => argv[0] === 'hud')
  expect(hudCall?.slice(0, 3)).toEqual(['hud', 'new', 'inbox'])
  // HUD_ROOT wins over ~/hud for the git status read
  expect(ran.find(argv => argv[0] === 'git')?.slice(0, 3)).toEqual(['git', '-C', '/data/hud'])

  const again = await $.command.run({ command: 'hud', args: 'flush' })
  expect(again.text).toBe('Nothing new to flush.')
})

test('a missing hud CLI keeps the receipts and says why', async ($, on) => {
  const mem = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: mem.get(e.key) }))
  on('store.set', ($, e) => {
    mem.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 1793400000000 }))
  on('session.id', () => ({ value: 'sess-2' }))
  on('env.get', () => ({ value: '/home/x' }))
  on('process.run', ($, e) => {
    if (e.argv[0] === 'hud') throw new Error('spawn hud ENOENT')
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('tool.call', () => ({ result: 'ok', text: 'https://github.com/example-org/example-repo/pull/7\n' }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  const flushed = await $.command.run({ command: 'hud', args: 'flush' })
  expect(flushed.text).toBe('Could not run the `hud` CLI (is it on PATH?). Receipts are kept; nothing was flushed.')
  const status = await $.command.run({ command: 'hud', args: '' })
  expect(status.text).toContain('1 receipt(s) this session, 1 not yet flushed')
})
