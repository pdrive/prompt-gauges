export type Window = { percent: number; resetsAt: number | null }
export type Limits = { fiveHour: Window | null; sevenDay: Window | null }
// ok: on pace; ahead: would run out before the reset, or 60% used; over: well past that, or 90% used (the defaults)
export type Pace = 'ok' | 'ahead' | 'over'
// The userConfig thresholds in percent; null is off
export type PaceConfig = { orangeUsed: number | null; redUsed: number | null; orangePace: number | null; redPace: number | null }

declare module 'claude-code' {
  interface PluginState {
    'limit-band': { limits: Limits; tick: number }
    // Read only, never written: Cache Maxxer's view, to lay this band beside or under it
    'cache-maxxer': { hidden: boolean; expanded: boolean }
  }
}
