import { expect, mock, test } from 'claude-code/testing'

import { colorFor, label, toLimits, untilReset } from '../hooks/register'

const NOW = Date.parse('2026-10-14T20:00:00Z')

test('colors run green to red', async () => {
  expect(colorFor(0)).toBe('#20df20')
  expect(colorFor(100)).toBe('#df2020')
  // Halfway is yellow: red and green both high, blue low
  const mid = colorFor(50)
  expect(parseInt(mid.slice(1, 3), 16)).toBeGreaterThan(200)
  expect(parseInt(mid.slice(3, 5), 16)).toBeGreaterThan(200)
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
