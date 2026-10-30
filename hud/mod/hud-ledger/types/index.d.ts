export type ReceiptKind = 'pr' | 'merge' | 'linear' | 'comment' | 'slack' | 'gdoc' | 'sync'

export type Receipt = {
  at: number
  kind: ReceiptKind
  label: string
  url?: string
}

declare module 'claude-code' {
  interface PluginState {
    'hud-ledger': {
      receipts: Shaped<Receipt[]>
      flushed: number
      dirty: number | null
    }
  }
}
