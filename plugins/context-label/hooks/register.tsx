import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, SessionContextUsage } from 'claude-code'

import type { Config, Ctx, Level } from '../types'

// The context window's fill in the prompt footer's mode slot, beside the model name: a four-cell bar
// ("■■☐☐", the filled squares colored by level, the empty ones dim), then "ctx 35% · 353k/1M".
// Kept short: the desktop slot is cut at a fixed width. Figures come from the last API response.
// The slot is drawn as a tree of our own: the desktop app ignores a rewritten `modes` list but draws a tree.
//
// Levels: green; yellow from where a turn gets dear (400k, or 100k on Haiku, whose price per token
// goes up 5x past it; the other Claude 4.6-and-later models price the full window the same); orange and red as a share
// of the way to auto-compaction (70% and 90%), which is what can break a chat.

const ctxAtom = atom({ plugin: 'context-label', key: 'ctx' } as const, null)
const thresholdAtom = atom({ plugin: 'context-label', key: 'threshold' } as const, null)
const modelAtom = atom({ plugin: 'context-label', key: 'model' } as const, null)

const BAR_CELLS = 4
const AUTO_YELLOW = 400_000
const HAIKU_YELLOW = 100_000

const COLORS: Record<Level, string> = { green: '#3cc43c', yellow: '#e0c020', orange: '#f08c1e', red: '#e8453c' }

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

// "400k" -> 400000, "80%" -> 0.8, "off" -> null
export function toConfig(options: PluginOptions): Config {
  const yellow = pick(options.yellow_at, ['auto', '100k', '200k', '300k', '400k', '500k', 'off'], 'auto')
  const orange = pick(options.orange_at, ['60%', '70%', '80%', '90%', 'off'], '70%')
  const red = pick(options.red_at, ['85%', '90%', '95%', 'off'], '90%')
  const show = pick(options.show, ['bar and text', 'bar', 'text'], 'bar and text')
  const pct = (s: string) => (s === 'off' ? null : parseInt(s, 10) / 100)
  return {
    yellowAt: yellow === 'auto' ? 'auto' : yellow === 'off' ? null : parseInt(yellow, 10) * 1_000,
    orangeAt: pct(orange),
    redAt: pct(red),
    show: show === 'bar and text' ? 'both' : show,
  }
}

// null until a response of the live window reported a fill (a fresh or just-compacted session).
export const toCtx = (c: SessionContextUsage): Ctx | null =>
  c.tokens === undefined ? null : { tokens: c.tokens, window: c.window, percent: c.percent ?? Math.round((100 * c.tokens) / c.window) }

// 353200 -> "353k", 45300 -> "45.3k", 1000000 -> "1M": no decimal from 100k up, to stay short
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return `${n}`
}

export const label = (c: Ctx) => `ctx ${c.percent}% · ${fmtTokens(c.tokens)}/${fmtTokens(c.window)}`

// The engine's own mode labels ("focus & memory paused") first, then ours.
export const footerText = (modes: readonly string[], c: Ctx) => [modes.join(' & '), label(c)].filter(Boolean).join(' · ')

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

// Orange and red measure the way to auto-compaction, or to the window's end with it off.
export function levelOf(c: Ctx, threshold: number | null, model: string | null, cfg: Config): Level {
  const end = threshold ?? c.window
  if (cfg.redAt !== null && c.tokens >= cfg.redAt * end) return 'red'
  if (cfg.orangeAt !== null && c.tokens >= cfg.orangeAt * end) return 'orange'
  const yellowAt = cfg.yellowAt === 'auto' ? (model && /haiku/i.test(model) ? HAIKU_YELLOW : AUTO_YELLOW) : cfg.yellowAt
  if (yellowAt !== null && c.tokens >= yellowAt) return 'yellow'
  return 'green'
}

// A cell fills once the fill is within a fifth of a cell of its end: with four, at 20%, 45%, 70%, 95%.
export const filledCells = (share: number) => Math.min(BAR_CELLS, Math.floor(BAR_CELLS * clamp01(share) + 0.2))

// The bar spans the whole window in cells, filled ones told apart by shape as well as color.
export function barText(c: Ctx): string {
  const filled = filledCells(c.tokens / c.window)
  return '■'.repeat(filled) + '☐'.repeat(BAR_CELLS - filled)
}

// The threshold moves only with the window (a model switch), so it is read then, not every response.
let thresholdFor: number | null = null

async function readThreshold($: EngineInterface, window: number) {
  if (thresholdFor === window) return
  thresholdFor = window
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    await update($, thresholdAtom, () => (b?.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null))
  } catch {
    thresholdFor = null
  }
}

async function readModel($: EngineInterface) {
  try {
    const model = await $.session.model()
    await update($, modelAtom, () => model)
  } catch {
    // Keep the last one
  }
}

export const register: Register = (on, options) => {
  const cfg = toConfig(options)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      const usage = await $.session.usage()
      await update($, ctxAtom, () => toCtx(usage.context))
      await readThreshold($, usage.context.window)
      await readModel($)
    } catch {
      // No reading yet: the label waits for the first response
    }
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await update($, ctxAtom, () => toCtx(e.context))
      await readThreshold($, e.context.window)
      await readModel($)
    }
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const c = await read($, ctxAtom)
    if (c === null) return next(e)
    const color = COLORS[levelOf(c, await read($, thresholdAtom), await read($, modelAtom), cfg)]
    const bar = barText(c)
    const { Box, Text } = $.ui.resolve(e)
    // Text only, and short: the desktop footer drops an Svg, and cuts the slot at a fixed width
    return (
      <Box flexDirection="row">
        {cfg.show !== 'text' && (
          // One Text with the two runs nested: as sibling Texts the desktop spaces them apart
          <Text key="bar">
            <Text color={color}>{bar.replace(/☐/g, '')}</Text>
            <Text dimColor>{bar.replace(/■/g, '')}</Text>
          </Text>
        )}
        {cfg.show !== 'bar' && <Text key="text" dimColor>{`${cfg.show === 'both' ? ' ' : ''}${footerText(e.props.modes, c)}`}</Text>}
      </Box>
    )
  })
}
