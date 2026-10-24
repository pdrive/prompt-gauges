export type Window = { percent: number; resetsAt: number | null }
export type Limits = { fiveHour: Window | null; sevenDay: Window | null }

declare module 'claude-code' {
  interface PluginState {
    'limit-band': { limits: Limits; tick: number }
    // Read only, never written: Cache Maxxer's view, to lay this band beside or under it
    'cache-maxxer': { hidden: boolean; expanded: boolean }
  }
}
