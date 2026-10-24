import { atom, read, update } from 'claude-code'
import type { ElementTable, PluginOptions, Register, RenderNode, SessionRateLimit } from 'claude-code'

import type { Limits, Pace, PaceConfig, Window } from '../types'

// A thin line above the prompt for the 5-hour usage window, with its percent and time to reset, and
// the 7-day window beside it. The bar is colored by pace, not by how full it is: where the window
// would end at the rate used so far (used % over the share of the window gone). Green on pace, orange
// when it would run out before the reset or once 60% is used, red well past that or once 90% is used
// (each a setting); `↑117%` says where it is heading, and a tick on the bar stands where the window's clock is.
// The percents come from the last API response; the countdowns tick here. It sits on the same row
// as whatever band is drawn beneath it (Cache Maxxer's): that band takes the room left, this sits at the right end.

const limitsAtom = atom({ plugin: 'limit-band', key: 'limits' } as const, { fiveHour: null, sevenDay: null })
const tickAtom = atom({ plugin: 'limit-band', key: 'tick' } as const, 0)
// Cache Maxxer's own values, read to know whether its band is open with its detail
const cmHidden = atom({ plugin: 'cache-maxxer', key: 'hidden' } as const, false)
const cmExpanded = atom({ plugin: 'cache-maxxer', key: 'expanded' } as const, false)

const TICK_MS = 30_000
const BAR_CELLS = 20
const BAR_PX = 80
const TRACK = '#8888884d'

const HOUR = 3_600_000
const FIVE_HOURS = 5 * HOUR
const SEVEN_DAYS = 7 * 24 * HOUR
const TICK = '#bdbdbd'
// Orange and red far enough apart to tell without the other beside them
export const PACE_COLORS: Record<Pace, string> = { ok: '#3cc43c', ahead: '#ff9800', over: '#e53935' }

export const DEFAULT_PACE: PaceConfig = { orangeUsed: 60, redUsed: 90, orangePace: 100, redPace: null }

// A whole-percent setting: 60 -> 60, 0 or "off" -> null (off); a value outside 0 to max, or no number
// at all, falls back to the default.
export function toPct(v: unknown, fallback: number | null, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? (v.trim() === 'off' ? 0 : parseInt(v, 10)) : NaN
  const pct = Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : (fallback ?? 0)
  return pct === 0 ? null : pct
}

// Checked from red down, so a lower level set above a higher one never shows: they cannot overlap.
export function toPaceConfig(options: PluginOptions): PaceConfig {
  return {
    orangeUsed: toPct(options.orange_used, DEFAULT_PACE.orangeUsed, 100),
    redUsed: toPct(options.red_used, DEFAULT_PACE.redUsed, 100),
    orangePace: toPct(options.orange_pace, DEFAULT_PACE.orangePace, 500),
    redPace: toPct(options.red_pace, DEFAULT_PACE.redPace, 500),
  }
}

// The band drawn beneath this one (Cache Maxxer's) with fixed-width digits on every Text, so its
// ticking seconds stop nudging the row; a copy, nothing else in it changed.
export function withTabularDigits(node: RenderNode | null | undefined): RenderNode | null | undefined {
  if (node === null || node === undefined || typeof node === 'string') return node
  const el = node as { type: string; props?: Record<string, unknown>; children?: unknown }
  const children = Array.isArray(el.children) ? el.children.map(c => withTabularDigits(c as RenderNode)) : el.children
  const props = el.type === 'Text' ? { ...(el.props ?? {}), tabular: true } : el.props
  return { ...el, ...(props ? { props } : {}), ...(children !== undefined ? { children } : {}) } as RenderNode
}

const toWindow = (l: SessionRateLimit | undefined): Window | null => {
  if (!l) return null
  const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  return { percent: l.percentUsed, resetsAt: Number.isNaN(at) ? null : at }
}

export const toLimits = (list: SessionRateLimit[]): Limits => ({
  fiveHour: toWindow(list.find(l => l.kind === 'five_hour')),
  sevenDay: toWindow(list.find(l => l.kind === 'seven_day')),
})

// How far through the window the clock is, 0 to 1; null without a reset time or once past it.
export function elapsedOf(w: Window, lengthMs: number, now: number): number | null {
  if (w.resetsAt === null || w.resetsAt <= now) return null
  return Math.min(Math.max(1 - (w.resetsAt - now) / lengthMs, 0), 1)
}

// Where the window ends at this rate, in percent; null before a tenth of it has gone (too early to say).
export function projectedOf(w: Window, lengthMs: number, now: number): number | null {
  const elapsed = elapsedOf(w, lengthMs, now)
  return elapsed === null || elapsed < 0.1 ? null : (w.percent / elapsed)
}

// Orange from a projected 100% or once 60% is used, red once 90% is used (the defaults; red by pace is
// off unless set): the used floors hold whatever the pace, since near the top little is left either way.
export function paceOf(w: Window, lengthMs: number, now: number, cfg: PaceConfig = DEFAULT_PACE): Pace {
  if (w.resetsAt !== null && w.resetsAt <= now) return 'ok'
  const projected = projectedOf(w, lengthMs, now)
  const reaches = (value: number | null, at: number | null) => value !== null && at !== null && value >= at
  if (reaches(w.percent, cfg.redUsed) || reaches(projected, cfg.redPace)) return 'over'
  if (reaches(w.percent, cfg.orangeUsed) || reaches(projected, cfg.orangePace)) return 'ahead'
  return 'ok'
}

// The pace alone, without the used floors: orange from `orangePace` projected, red from `redPace`;
// null while the projection reaches neither (or both are off). The `↑` hint and its color follow it.
export function hintPaceOf(w: Window, lengthMs: number, now: number, cfg: PaceConfig = DEFAULT_PACE): Pace | null {
  const projected = projectedOf(w, lengthMs, now)
  if (projected === null) return null
  if (cfg.redPace !== null && projected >= cfg.redPace) return 'over'
  if (cfg.orangePace !== null && projected >= cfg.orangePace) return 'ahead'
  return null
}

// " ↑117%" once the projection reaches the orange (or red) pace setting, else ''.
export function paceHint(w: Window, lengthMs: number, now: number, cfg: PaceConfig = DEFAULT_PACE): string {
  const projected = projectedOf(w, lengthMs, now)
  return projected !== null && hintPaceOf(w, lengthMs, now, cfg) !== null ? ` ↑${Math.round(projected)}%` : ''
}

// "2h 14m", "3d 4h", "12m"; null when the window has no reset time.
export function untilReset(resetsAt: number | null, now: number): string | null {
  if (resetsAt === null) return null
  const mins = Math.max(0, Math.ceil((resetsAt - now) / 60_000))
  if (mins === 0) return 'reset'
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const fmtPct = (p: number) => `${Math.round(p)}%`

// "42% (2h 14m)"; a window past its reset reads 0%, since the next response will say so.
export function label(w: Window, now: number): string {
  const left = untilReset(w.resetsAt, now)
  const isPast = left === 'reset'
  return `${isPast ? '0%' : fmtPct(w.percent)}${left && !isPast ? ` (${left})` : ''}`
}

const shownPercent = (w: Window, now: number) => (w.resetsAt !== null && w.resetsAt <= now ? 0 : w.percent)

// How full the window is, by the used floors alone: green, orange from 60%, red from 90% (the defaults).
export function fillOf(percent: number, cfg: PaceConfig = DEFAULT_PACE): Pace {
  if (cfg.redUsed !== null && percent >= cfg.redUsed) return 'over'
  if (cfg.orangeUsed !== null && percent >= cfg.orangeUsed) return 'ahead'
  return 'ok'
}

// The band's text as runs, each with its color or none (dim): the 5-hour percent by how full it is,
// each hint's `↑` alone by its window's pace (its number dim), the times and the 7-day percent dim.
// "67% (2h 21m) ↑126% · 7d 33% (4d 17h) ↑102%"
export function textRuns(five: Window, seven: Window | null, now: number, cfg: PaceConfig = DEFAULT_PACE): { text: string; color?: string }[] {
  const left = (w: Window) => {
    const t = untilReset(w.resetsAt, now)
    return t && t !== 'reset' ? ` (${t})` : ''
  }
  const fivePct = shownPercent(five, now)
  const runs: { text: string; color?: string }[] = [
    { text: fmtPct(fivePct), color: PACE_COLORS[fillOf(fivePct, cfg)] },
    { text: left(five) },
  ]
  // " ↑126%" as " ", "↑" in the pace color, "126%" dim
  const hint = (text: string, pace: Pace) => runs.push({ text: ' ' }, { text: '↑', color: PACE_COLORS[pace] }, { text: text.slice(2) })
  const fiveHint = paceHint(five, FIVE_HOURS, now, cfg)
  if (fiveHint) hint(fiveHint, hintPaceOf(five, FIVE_HOURS, now, cfg) ?? 'ahead')
  if (seven) {
    runs.push({ text: ` · 7d ${fmtPct(shownPercent(seven, now))}${left(seven)}` })
    const sevenHint = paceHint(seven, SEVEN_DAYS, now, cfg)
    if (sevenHint) hint(sevenHint, hintPaceOf(seven, SEVEN_DAYS, now, cfg) ?? 'ahead')
  }
  return runs
}

const PACE_WORDS: Record<Pace, string> = { ok: 'on pace', ahead: 'ahead of pace', over: 'well ahead of pace' }

// What the bar says, for its hover tooltip and its alt text:
// "5-hour limit: 67% used, 53% of the window gone (resets in 2h 21m). At this rate: 126% by the reset, ahead of pace."
export function barTitle(w: Window, now: number, cfg: PaceConfig = DEFAULT_PACE): string {
  const pct = shownPercent(w, now)
  const elapsed = elapsedOf(w, FIVE_HOURS, now)
  const left = untilReset(w.resetsAt, now)
  const projected = projectedOf(w, FIVE_HOURS, now)
  const fill = fillOf(pct, cfg)
  return (
    `5-hour limit: ${fmtPct(pct)} used` +
    (elapsed === null ? '' : `, ${fmtPct(elapsed * 100)} of the window gone`) +
    (left && left !== 'reset' ? ` (resets in ${left})` : '') +
    '.' +
    (projected === null ? ' Too early in the window to project.' : ` At this rate: ${fmtPct(projected)} by the reset, ${PACE_WORDS[paceOf(w, FIVE_HOURS, now, cfg)]}.`) +
    (fill === 'ok' ? '' : ` Past the ${fill === 'over' ? 'red' : 'orange'} line of ${fmtPct((fill === 'over' ? cfg.redUsed : cfg.orangeUsed) ?? 0)} used.`)
  )
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The bar is 4px high in an 8px box, so the clock's tick stands out above and below it. A transparent
// rect over the whole box carries the hover tooltip, so it shows anywhere on the bar.
export function barSvg(percent: number, pace: Pace, elapsed: number | null, width = BAR_PX, title = ''): string {
  const fill = Math.round((width * Math.min(Math.max(percent, 0), 100)) / 100)
  const tickX = elapsed === null ? null : Math.min(width - 2, Math.max(0, Math.round(elapsed * width) - 1))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    (title ? `<title>${escapeXml(title)}</title>` : '') +
    `<rect x="0" y="2" width="${width}" height="4" rx="2" fill="${TRACK}"/>` +
    (fill > 0 ? `<rect x="0" y="2" width="${fill}" height="4" rx="2" fill="${PACE_COLORS[pace]}"/>` : '') +
    (tickX === null ? '' : `<rect x="${tickX}" y="0" width="2" height="8" rx="1" fill="${TICK}"/>`) +
    (title ? `<rect x="0" y="0" width="${width}" height="8" fill="transparent"><title>${escapeXml(title)}</title></rect>` : '') +
    `</svg>`
  )
}

// The terminal's bar in cells, the clock's cell drawn as a tick: runs of one kind each.
export function barCells(percent: number, elapsed: number | null): { kind: 'fill' | 'track' | 'tick'; text: string }[] {
  const filled = Math.round((BAR_CELLS * Math.min(Math.max(percent, 0), 100)) / 100)
  const tickAt = elapsed === null ? -1 : Math.min(BAR_CELLS - 1, Math.floor(elapsed * BAR_CELLS))
  const runs: { kind: 'fill' | 'track' | 'tick'; text: string }[] = []
  for (let i = 0; i < BAR_CELLS; i++) {
    const kind = i === tickAt ? 'tick' : i < filled ? 'fill' : 'track'
    const ch = kind === 'tick' ? '┃' : kind === 'fill' ? '━' : '─'
    const last = runs[runs.length - 1]
    if (last?.kind === kind) last.text += ch
    else runs.push({ kind, text: ch })
  }
  return runs
}

export const register: Register = (on, options) => {
  const paceCfg = toPaceConfig(options)
  let timer: { cancel: () => void } | null = null

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      const usage = await $.session.usage()
      await update($, limitsAtom, () => toLimits(usage.rateLimits))
    } catch {
      // No reading yet: the band waits for the first response
    }
    timer?.cancel()
    timer = $.clock.every(TICK_MS, async () => {
      const now = await $.clock.now()
      await update($, tickAtom, () => now)
    })
    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await update($, limitsAtom, () => toLimits(e.rateLimits))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tickAtom)
    const limits = await read($, limitsAtom)
    const five = limits.fiveHour
    if (e.props.hasSurvey || five === null) return next(e)

    const rest = withTabularDigits(await next(e))
    const now = await $.clock.now()
    const pct = shownPercent(five, now)
    const pace = paceOf(five, FIVE_HOURS, now, paceCfg)
    const elapsed = elapsedOf(five, FIVE_HOURS, now)
    const seven = limits.sevenDay
    const runs = textRuns(five, seven, now, paceCfg)
    const title = barTitle(five, now, paceCfg)
    // Beside Cache Maxxer's band on one row, except when its detail is open: then under it, full width.
    const isUnder = !(await read($, cmHidden)) && (await read($, cmExpanded))
    const row = { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', columnGap: 2 } as const
    const column = { flexDirection: 'column', rowGap: 1 } as const
    const outer = isUnder ? column : row

    if (e.surface === 'desktop') {
      const { Box, Svg, Text } = $.ui.resolve(e) as ElementTable<'desktop'>
      return (
        <Box {...outer}>
          {rest}
          <Box key="limit-band" flexDirection="row" alignItems="center" columnGap={1} paddingX={1} flexShrink={0}>
            <Text key="name" dimColor>5h</Text>
            <Svg
              key="bar"
              source={barSvg(pct, pace, elapsed, isUnder ? BAR_PX * 2 : BAR_PX, title)}
              alt={title}
              isInteractive
              width={isUnder ? BAR_PX * 2 : BAR_PX}
              height={8}
            />
            {/* One Text with the runs nested: as sibling Texts the desktop spaces them apart */}
            <Text key="text" dimColor tabular>
              {runs.map((r, i) => (r.color ? <Text key={`t${i}`} color={r.color}>{r.text}</Text> : r.text))}
            </Text>
          </Box>
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box {...outer}>
        {rest}
        <Box key="limit-band" flexDirection="row" flexShrink={0}>
          <Text key="name" dimColor>5h </Text>
          {barCells(pct, elapsed).map((r, i) =>
            r.kind === 'fill' ? <Text key={`b${i}`} color={PACE_COLORS[pace]}>{r.text}</Text>
            : r.kind === 'tick' ? <Text key={`b${i}`} color={TICK}>{r.text}</Text>
            : <Text key={`b${i}`} dimColor>{r.text}</Text>,
          )}
          <Text key="text" dimColor tabular>
            {' '}
            {runs.map((r, i) => (r.color ? <Text key={`t${i}`} color={r.color}>{r.text}</Text> : r.text))}
          </Text>
        </Box>
      </Box>
    )
  })
}
