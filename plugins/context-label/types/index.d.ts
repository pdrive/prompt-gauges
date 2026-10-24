export type Ctx = { tokens: number; window: number; percent: number }
export type Level = 'green' | 'yellow' | 'orange' | 'red'
// The userConfig values, read once per load
export type Config = { yellowAt: number | 'auto' | null; orangeAt: number | null; redAt: number | null; show: 'both' | 'bar' | 'text' }

declare module 'claude-code' {
  interface PluginState {
    // threshold: the token count auto-compaction runs at; null when it is off or not read yet
    'context-label': { ctx: Ctx | null; threshold: number | null; model: string | null }
  }
}
