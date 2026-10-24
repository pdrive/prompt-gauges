import { atom, read, update } from 'claude-code'
import type { ElementTable, Register, SessionRateLimit } from 'claude-code'

import type { Limits, Window } from '../types'

// A thin line above the prompt for the 5-hour usage window, colored from green through yellow and
// orange to red as it fills, with its percent and time to reset, and the 7-day window beside it.
// The percents come from the last API response; the countdowns tick here. It sits on the same row
// as whatever band is drawn beneath it (Cache Maxxer's): that band takes the room left, this sits at the right end.

const limitsAtom = atom({ plugin: 'limit-band', key: 'limits' } as const, { fiveHour: null, sevenDay: null })
const tickAtom = atom({ plugin: 'limit-band', key: 'tick' } as const, 0)
// Cache Maxxer's own values, read to know whether its band is open with its detail
const cmHidden = atom({ plugin: 'cache-maxxer', key: 'hidden' } as const, false)
const cmExpanded = atom({ plugin: 'cache-maxxer', key: 'expanded' } as const, false)

const TICK_MS = 30_000
const BAR_CELLS = 20
const BAR_PX = 160
const TRACK = '#8888884d'

const toWindow = (l: SessionRateLimit | undefined): Window | null => {
  if (!l) return null
  const at = l.resetsAt ? Date.parse(l.resetsAt) : NaN
  return { percent: l.percentUsed, resetsAt: Number.isNaN(at) ? null : at }
}

export const toLimits = (list: SessionRateLimit[]): Limits => ({
  fiveHour: toWindow(list.find(l => l.kind === 'five_hour')),
  sevenDay: toWindow(list.find(l => l.kind === 'seven_day')),
})

// Hue 120 (green) at 0% down to 0 (red) at 100%: yellow near half, orange near 70%.
export function colorFor(percent: number): string {
  const p = Math.min(Math.max(percent, 0), 100) / 100
  const hue = 120 * (1 - p)
  const s = 0.75
  const l = 0.5
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
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

function barSvg(percent: number): string {
  const fill = Math.round((BAR_PX * Math.min(Math.max(percent, 0), 100)) / 100)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_PX}" height="4" viewBox="0 0 ${BAR_PX} 4">` +
    `<rect x="0" y="0" width="${BAR_PX}" height="4" rx="2" fill="${TRACK}"/>` +
    (fill > 0 ? `<rect x="0" y="0" width="${fill}" height="4" rx="2" fill="${colorFor(percent)}"/>` : '') +
    `</svg>`
  )
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
    const seven = limits.sevenDay
    const tail = `${label(five, now)}${seven ? `  ·  7d ${label(seven, now)}` : ''}`
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
            <Svg key="bar" source={barSvg(pct)} alt={`5-hour limit ${fmtPct(pct)} used`} width={isUnder ? BAR_PX * 2 : BAR_PX} height={4} />
            <Text key="text" dimColor>{tail}</Text>
          </Box>
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const filled = Math.round((BAR_CELLS * Math.min(Math.max(pct, 0), 100)) / 100)
    return (
      <Box {...outer}>
        {rest}
        <Box key="limit-band" flexDirection="row" flexShrink={0}>
          <Text key="name" dimColor>5h </Text>
          <Text key="fill" color={colorFor(pct)}>{'━'.repeat(filled)}</Text>
          <Text key="track" dimColor>{'─'.repeat(BAR_CELLS - filled)}</Text>
          <Text key="text" dimColor>{` ${tail}`}</Text>
        </Box>
      </Box>
    )
  })
}
