import { atom, read, update } from 'claude-code'
import type { ElementTable, Register, SessionRateLimit } from 'claude-code'

import type { Limits, Pace, Window } from '../types'

// A thin line above the prompt for the 5-hour usage window, with its percent and time to reset, and
// the 7-day window beside it. The bar is colored by pace, not by how full it is: where the window
// would end at the rate used so far (used % over the share of the window gone). Green on pace, amber
// when it would run out before the reset, red well past that or once 80% is used; `↑117%` says where
// it is heading, and a tick on the bar stands where the window's clock is.
// The percents come from the last API response; the countdowns tick here. It sits on the same row
// as whatever band is drawn beneath it (Cache Maxxer's): that band takes the room left, this sits at the right end.

const limitsAtom = atom({ plugin: 'limit-band', key: 'limits' } as const, { fiveHour: null, sevenDay: null })
const tickAtom = atom({ plugin: 'limit-band', key: 'tick' } as const, 0)
// Cache Maxxer's own values, read to know whether its band is open with its detail
const cmHidden = atom({ plugin: 'cache-maxxer', key: 'hidden' } as const, false)
const cmExpanded = atom({ plugin: 'cache-maxxer', key: 'expanded' } as const, false)

const TICK_MS = 30_000
const BAR_CELLS = 20
const BAR_PX = 120
const TRACK = '#8888884d'

const HOUR = 3_600_000
const FIVE_HOURS = 5 * HOUR
const SEVEN_DAYS = 7 * 24 * HOUR
const TICK = '#bdbdbd'
export const PACE_COLORS: Record<Pace, string> = { ok: '#3cc43c', ahead: '#e0a020', over: '#e8453c' }

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

// Amber from a projected 100%, red from 125% or once 80% is used, whatever the pace.
export function paceOf(w: Window, lengthMs: number, now: number): Pace {
  if (w.resetsAt !== null && w.resetsAt <= now) return 'ok'
  const projected = projectedOf(w, lengthMs, now)
  if (w.percent >= 80 || (projected !== null && projected >= 125)) return 'over'
  if (projected !== null && projected >= 100) return 'ahead'
  return 'ok'
}

// " ↑117%" when the window is heading past its limit, else ''.
export function paceHint(w: Window, lengthMs: number, now: number): string {
  const projected = projectedOf(w, lengthMs, now)
  return projected !== null && projected >= 100 ? ` ↑${Math.round(projected)}%` : ''
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

// The bar is 4px high in an 8px box, so the clock's tick stands out above and below it.
export function barSvg(percent: number, pace: Pace, elapsed: number | null, width = BAR_PX): string {
  const fill = Math.round((width * Math.min(Math.max(percent, 0), 100)) / 100)
  const tickX = elapsed === null ? null : Math.min(width - 2, Math.max(0, Math.round(elapsed * width) - 1))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect x="0" y="2" width="${width}" height="4" rx="2" fill="${TRACK}"/>` +
    (fill > 0 ? `<rect x="0" y="2" width="${fill}" height="4" rx="2" fill="${PACE_COLORS[pace]}"/>` : '') +
    (tickX === null ? '' : `<rect x="${tickX}" y="0" width="2" height="8" rx="1" fill="${TICK}"/>`) +
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

export const register: Register = on => {
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

    const rest = await next(e)
    const now = await $.clock.now()
    const pct = shownPercent(five, now)
    const pace = paceOf(five, FIVE_HOURS, now)
    const elapsed = elapsedOf(five, FIVE_HOURS, now)
    const seven = limits.sevenDay
    const tail =
      `${label(five, now)}${paceHint(five, FIVE_HOURS, now)}` +
      (seven ? ` · 7d ${label(seven, now)}${paceHint(seven, SEVEN_DAYS, now)}` : '')
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
              source={barSvg(pct, pace, elapsed, isUnder ? BAR_PX * 2 : BAR_PX)}
              alt={`5-hour limit ${fmtPct(pct)} used${elapsed === null ? '' : `, ${fmtPct(elapsed * 100)} of the window gone`}`}
              width={isUnder ? BAR_PX * 2 : BAR_PX}
              height={8}
            />
            <Text key="text" dimColor>{tail}</Text>
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
          <Text key="text" dimColor>{` ${tail}`}</Text>
        </Box>
      </Box>
    )
  })
}
