import { expect, mock, test } from 'claude-code/testing'

import { barCells, barSvg, elapsedOf, label, PACE_COLORS, paceHint, paceOf, projectedOf, toLimits, untilReset } from '../hooks/register'

const NOW = Date.parse('2026-10-14T20:00:00Z')

const H = 3_600_000
const at = (percent: number, minutesLeft: number) => ({ percent, resetsAt: NOW + minutesLeft * 60_000 })

test('pace: projected use over the share of the window gone', async () => {
  // 49% used with 2h 56m left of 5h: 41% gone, heading for 119%
  expect(Math.round(elapsedOf(at(49, 176), 5 * H, NOW)! * 1000)).toBe(413)
  expect(Math.round(projectedOf(at(49, 176), 5 * H, NOW)!)).toBe(119)
  expect(paceOf(at(49, 176), 5 * H, NOW)).toBe('ahead')
  expect(paceHint(at(49, 176), 5 * H, NOW)).toBe('  ↑119%')
  // On pace: 30% used halfway
  expect(paceOf(at(30, 150), 5 * H, NOW)).toBe('ok')
  expect(paceHint(at(30, 150), 5 * H, NOW)).toBe('')
  // Well past it, or 80% used whatever the clock
  expect(paceOf(at(70, 150), 5 * H, NOW)).toBe('over')
  expect(paceOf(at(80, 10), 5 * H, NOW)).toBe('over')
  // Too early to say before a tenth of the window: only the 80% backstop
  expect(projectedOf(at(20, 290), 5 * H, NOW)).toBe(null)
  expect(paceOf(at(20, 290), 5 * H, NOW)).toBe('ok')
  // Past its reset or with no reset time: no pace, no tick
  expect(paceOf(at(90, -1), 5 * H, NOW)).toBe('ok')
  expect(elapsedOf({ percent: 10, resetsAt: null }, 5 * H, NOW)).toBe(null)
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
    expect(await ui.find({ type: 'Text', text: /42% \(1h 30m\)  ·  7d 18% \(2d 2h\)/ })).toBeDefined()
    await ui.unmount()
  }
})
