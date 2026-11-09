export type Ctx = { tokens: number; window: number; percent: number }
export type Level = 'green' | 'yellow' | 'orange' | 'red'
// The userConfig values, read once per load
// Shares are 0 to 1, null is off; haikuStep puts yellow at the 100k price step of Haiku 5.5; cells is the bar's length; end, what follows the tokens
export type Config = { yellowAt: number | null; haikuStep: boolean; orangeAt: number | null; redAt: number | null; show: 'both' | 'bar' | 'text'; cells: number; end: 'style' | 'window' | 'none' }

declare module 'claude-code' {
  interface PluginState {
    // threshold: the token count auto-compaction runs at; null when it is off or not read yet
    // style: the output style's name, "default" for none; null until a prompt is composed
    'context-label': { ctx: Ctx | null; threshold: number | null; model: string | null; style: string | null }
  }
}
