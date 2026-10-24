import { expect, mock, test } from 'claude-code/testing'

import { barText, filledCells, fmtTokens, footerText, levelOf, toConfig } from '../hooks/register'

const c = { tokens: 353_200, window: 1_000_000, percent: 35 }
const at = (tokens: number) => ({ ...c, tokens })

test('tokens read in k and M', () => {
  expect(fmtTokens(353_200)).toBe('353k')
  expect(fmtTokens(45_300)).toBe('45.3k')
  expect(fmtTokens(200_000)).toBe('200k')
  expect(fmtTokens(1_000_000)).toBe('1M')
})

test('the label follows the engine modes', () => {
  expect(footerText([], c)).toBe('ctx 35% · 353k/1M')
  expect(footerText(['focus', 'memory paused'], c)).toBe('focus & memory paused · ctx 35% · 353k/1M')
})

test('the bar fills a cell at 20, 45, 70 and 95% of the window', () => {
  expect([0.01, 0.15, 0.19, 0.2, 0.23, 0.44, 0.45, 0.7, 0.94, 0.95, 1].map(filledCells)).toEqual([0, 0, 0, 1, 1, 1, 2, 3, 3, 4, 4])
  expect(barText(c)).toBe('■☐☐☐')
  expect(barText(at(0))).toBe('☐☐☐☐')
  expect(barText(at(1_000_000))).toBe('■■■■')
})

test('levels by default: yellow at 400k (100k on Haiku), orange and red at 70 and 90% of auto-compact', () => {
  const cfg = toConfig({})
  const opus = (n: number) => levelOf(at(n), 967_000, 'claude-opus-5-5', cfg)
  expect([399_000, 400_000, 676_000, 677_000, 870_000, 871_000].map(opus)).toEqual(['green', 'yellow', 'yellow', 'orange', 'orange', 'red'])
  const haiku = (n: number) => levelOf(at(n), 967_000, 'claude-haiku-5-5', cfg)
  expect([99_000, 100_000].map(haiku)).toEqual(['green', 'yellow'])
  // Auto-compact off: orange and red measure the whole window
  expect(levelOf(at(800_000), null, 'claude-opus-5-5', cfg)).toBe('orange')
  expect(levelOf(at(900_000), null, 'claude-opus-5-5', cfg)).toBe('red')
})

test('settings move or turn off each level', () => {
  const cfg = toConfig({ yellow_at: '200k', orange_at: 'off', red_at: '85%', show: 'bar' })
  expect(cfg).toEqual({ yellowAt: 200_000, orangeAt: null, redAt: 0.85, show: 'bar' })
  expect(levelOf(at(800_000), 967_000, 'claude-opus-5-5', cfg)).toBe('yellow')
  expect(levelOf(at(822_000), 967_000, 'claude-opus-5-5', cfg)).toBe('red')
  // A value outside the picker falls back to its default
  expect(toConfig({ red_at: '50%' }).redAt).toBe(0.9)
})

test('the footer draws on terminal and desktop once a reading arrives', async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($e, e) => h($e.ui.resolve(e).Text, {}, 'engine') as never)
  mock.clock(on, { now: 0 })
  await $.session.measure({
    context: { tokens: 353_200, window: 1_000_000, percent: 35 },
    rateLimits: [],
    changed: ['context'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-label', surface, component: 'SessionMode', props: { modes: [] } })
    expect(await ui.find({ type: 'Text', text: /ctx 35% · 353k\/1M/ })).toBeDefined()
    await ui.unmount()
  }
})

test('show: bar leaves the text out', { options: { show: 'bar' } }, async ($, on) => {
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.render', ($e, e) => h($e.ui.resolve(e).Text, {}, 'engine') as never)
  await $.session.measure({ context: { tokens: 353_200, window: 1_000_000, percent: 35 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({ plugin: 'context-label', surface: 'desktop', component: 'SessionMode', props: { modes: [] } })
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /■/ })).toBeDefined()
  await ui.unmount()
})
