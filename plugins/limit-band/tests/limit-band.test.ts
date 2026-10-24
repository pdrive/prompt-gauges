import { expect, mock, test } from 'claude-code/testing'

import { barCells, barSvg, barTitle, elapsedOf, fillOf, hintPaceOf, label, PACE_COLORS, paceHint, paceOf, projectedOf, textRuns, toLimits, toPaceConfig, untilReset } from '../hooks/register'

const NOW = Date.parse('2026-10-14T20:00:00Z')

const H = 3_600_000
const at = (percent: number, minutesLeft: number) => ({ percent, resetsAt: NOW + minutesLeft * 60_000 })

test('pace: projected use over the share of the window gone', async () => {
  // 49% used with 2h 56m left of 5h: 41% gone, heading for 119%
  expect(Math.round(elapsedOf(at(49, 176), 5 * H, NOW)! * 1000)).toBe(413)
  expect(Math.round(projectedOf(at(49, 176), 5 * H, NOW)!)).toBe(119)
  expect(paceOf(at(49, 176), 5 * H, NOW)).toBe('ahead')
  expect(paceHint(at(49, 176), 5 * H, NOW)).toBe(' ↑119%')
  // On pace: 30% used halfway
  expect(paceOf(at(30, 150), 5 * H, NOW)).toBe('ok')
  expect(paceHint(at(30, 150), 5 * H, NOW)).toBe('')
  // Well past pace is still orange by default: red is kept for 90% used
  expect(paceOf(at(70, 150), 5 * H, NOW)).toBe('ahead')
  expect(paceOf(at(70, 150), 5 * H, NOW, toPaceConfig({ red_pace: 125 }))).toBe('over')
  expect(paceOf(at(90, 10), 5 * H, NOW)).toBe('over')
  expect(paceOf(at(89, 10), 5 * H, NOW)).toBe('ahead')
  // Orange from 60% used even behind pace: 60% with 30m left is heading for 67%
  expect(paceOf(at(59, 30), 5 * H, NOW)).toBe('ok')
  expect(paceOf(at(60, 30), 5 * H, NOW)).toBe('ahead')
  // Too early to say before a tenth of the window: only the used floors
  expect(projectedOf(at(20, 290), 5 * H, NOW)).toBe(null)
  expect(paceOf(at(20, 290), 5 * H, NOW)).toBe('ok')
  // Past its reset or with no reset time: no pace, no tick
  expect(paceOf(at(90, -1), 5 * H, NOW)).toBe('ok')
  expect(elapsedOf({ percent: 10, resetsAt: null }, 5 * H, NOW)).toBe(null)
})

test('the text colors the 5-hour percent by fill and each hint arrow by pace, the rest dim', async () => {
  const D = 24 * 60
  const runs = textRuns(at(67, 141), at(33, 4 * D + 17 * 60), NOW)
  expect(runs.map(r => r.text).join('')).toBe('67% (2h 21m) ↑126% · 7d 33% (4d 17h) ↑101%')
  expect(runs).toEqual([
    { text: '67%', color: PACE_COLORS.ahead },
    { text: ' (2h 21m)' },
    { text: ' ' },
    { text: '↑', color: PACE_COLORS.ahead },
    { text: '126%' },
    { text: ' · 7d 33% (4d 17h)' },
    { text: ' ' },
    { text: '↑', color: PACE_COLORS.ahead },
    { text: '101%' },
  ])
  // By fill alone: green below 60%, orange from 60%, red from 90%
  expect([59, 60, 89, 90].map(p => fillOf(p))).toEqual(['ok', 'ahead', 'ahead', 'over'])
  // On pace: no hints, the 5-hour percent green
  expect(textRuns(at(30, 150), null, NOW)).toEqual([{ text: '30%', color: PACE_COLORS.ok }, { text: ' (2h 30m)' }])
})

test('settings move or turn off each threshold', async () => {
  expect(toPaceConfig({})).toEqual({ orangeUsed: 60, redUsed: 90, orangePace: 100, redPace: null })
  const cfg = toPaceConfig({ orange_used: 0, red_used: 80, orange_pace: '110%', red_pace: 'off' })
  expect(cfg).toEqual({ orangeUsed: null, redUsed: 80, orangePace: 110, redPace: null })
  // 49% heading for 119%: still orange with orange at a projected 110%
  expect(paceOf(at(49, 176), 5 * H, NOW, cfg)).toBe('ahead')
  // 70% halfway heads for 140%: red by default, only orange with the pace red off
  expect(paceOf(at(70, 150), 5 * H, NOW, cfg)).toBe('ahead')
  expect(paceOf(at(80, 10), 5 * H, NOW, cfg)).toBe('over')
  // 65% with 30m left heads for 72%: orange by the 60% floor, green with it off
  expect(paceOf(at(65, 30), 5 * H, NOW)).toBe('ahead')
  expect(paceOf(at(65, 30), 5 * H, NOW, cfg)).toBe('ok')
  // Any whole number in range; out of range or no number: the default
  expect(toPaceConfig({ orange_used: '65', red_used: 95 })).toMatchObject({ orangeUsed: 65, redUsed: 95 })
  expect(toPaceConfig({ red_used: 150, orange_pace: 'soon' })).toMatchObject({ redUsed: 90, orangePace: 100 })
})

test('the arrow follows the pace settings: shown from orange_pace, red from red_pace', async () => {
  // 49% heading for 119%
  expect(paceHint(at(49, 176), 5 * H, NOW, toPaceConfig({ orange_pace: 120 }))).toBe('')
  expect(paceHint(at(49, 176), 5 * H, NOW, toPaceConfig({ orange_pace: 110 }))).toBe(' ↑119%')
  expect(hintPaceOf(at(49, 176), 5 * H, NOW, toPaceConfig({ red_pace: 115 }))).toBe('over')
  expect(paceHint(at(49, 176), 5 * H, NOW, toPaceConfig({ orange_pace: 0 }))).toBe('')
  // The used floors do not color the arrow: 65% used on pace has no arrow
  expect(paceHint(at(65, 30), 5 * H, NOW)).toBe('')
})

test('hovering the bar says what it shows', async () => {
  expect(barTitle(at(67, 141), NOW)).toBe(
    '5-hour limit: 67% used, 53% of the window gone (resets in 2h 21m). At this rate: 126% by the reset, ahead of pace. Past the orange line of 60% used.',
  )
  expect(barTitle(at(10, 290), NOW)).toBe('5-hour limit: 10% used, 3% of the window gone (resets in 4h 50m). Too early in the window to project.')
  expect(barSvg(50, 'ok', 0.5, 80, 'a < b')).toContain('<title>a &lt; b</title>')
})

test('the bar shows the fill in its pace color and a tick at the clock', async () => {
  const svg = barSvg(50, 'ahead', 0.25, 160)
  expect(svg).toContain(`width="80" height="4" rx="2" fill="${PACE_COLORS.ahead}"`)
  expect(svg).toContain('x="39" y="0" width="2" height="8"')
  expect(barSvg(50, 'ok', null, 160)).not.toContain('height="8" rx="1"')
  expect(barCells(50, 0.25).map(r => r.text).join('')).toBe('━━━━━┃━━━━──────────')
  expect(barCells(10, 0.9).map(r => r.text).join('')).toBe('━━────────────────┃─')
})

test('time to reset reads in days, hours or minutes', async () => {
  expect(untilReset(NOW + (2 * 60 + 14) * 60_000, NOW)).toBe('2h 14m')
  expect(untilReset(NOW + (3 * 24 + 4) * 3_600_000, NOW)).toBe('3d 4h')
  expect(untilReset(NOW + 12 * 60_000, NOW)).toBe('12m')
  expect(untilReset(NOW - 1000, NOW)).toBe('reset')
  expect(untilReset(null, NOW)).toBe(null)
})

test('windows are picked by kind and labelled', async () => {
  const limits = toLimits([
    { kind: 'five_hour', percentUsed: 42.5, resetsAt: new Date(NOW + 90 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(NOW + 50 * 3_600_000).toISOString() },
  ])
  expect(label(limits.fiveHour!, NOW)).toBe('43% (1h 30m)')
  expect(label(limits.sevenDay!, NOW)).toBe('18% (2d 2h)')
  // Past its reset, a window reads 0% until the next response says otherwise
  expect(label(limits.fiveHour!, NOW + 2 * 3_600_000)).toBe('0%')
  expect(toLimits([]).fiveHour).toBe(null)
})

test('the band draws on terminal and desktop once a reading arrives', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // The engine's own band beneath ours: an empty box
  on('ui.render', ($e, e) => h($e.ui.resolve(e).Box, { key: 'engine' }) as never)
  const now = NOW
  mock.clock(on, { now })
  await $.session.measure({
    context: { window: 200_000 } as never,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: new Date(now + 90 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 18, resetsAt: new Date(now + 50 * 3_600_000).toISOString() },
    ],
    changed: ['rateLimits'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'limit-band',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
    })
    expect(await ui.find({ key: 'limit-band' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /42% \(1h 30m\) · 7d 18% \(2d 2h\)/ })).toBeDefined()
    await ui.unmount()
  }
})
