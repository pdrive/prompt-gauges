# Changelog

Newest first. `claude plugin list` shows the version you have; `claude plugin update <mod>@prompt-gauges` gets the latest.

## context-label

### 0.7.0
- A five-square bar instead of four; `bar_cells` sets it from 4 to 20 (the desktop footer cuts the slot at a fixed width, so a long bar clips the text).
- The text drops its middle dot: `ctx 35% 353k/1M`, to fit.
- A square fills once the fill is halfway into it (10%, 30%, 50%, 70%, 90% with five), instead of when it is nearly full.

### 0.6.0
- The ctx text is drawn in the monospace face.

### 0.5.0
- Thresholds are plain whole numbers, 0 to 100; 0 turns a level off.
- Yellow from half the context window (100k on Haiku 5.5, where its price per token goes up; `haiku_price_step` switches that off).
- Orange from 72% and red from 93% of the way to auto-compact.

### 0.4.0
- First release: a four-square bar in the prompt footer, colored green, yellow, orange and red, with `ctx 35% · 353k/1M` beside it, and its settings in `/config`.

## limit-band

### 0.7.0
- The `↑` hint follows the pace settings: shown from `orange_pace`, red past `red_pace`.
- Fixed-width digits, so the ticking countdowns don't shift the row; also on Cache Maxxer's band beside it, until that band sets them itself.
- No hover tooltip on the bar: its frame flashed on every redraw.

### 0.6.0
- Thresholds are plain whole numbers (0 is off); the bar is 80px wide.

### 0.5.0
- Orange instead of amber, and a clearer red.
- Red only from 90% used; red by pace is a setting, off by default.
- The 5-hour percent is colored by how full the window is; only the hint's `↑` takes the pace color; times and the 7-day percent stay dim.
- The 7-day window gets its own `↑` projection.

### 0.4.0
- Pace thresholds and used floors in `/config`; orange from 60% used and red from 90% used, whatever the pace.

### 0.3.0
- The bar is colored by pace (where the window ends at the current rate), with a `↑` projection and a tick at the window's clock.

### 0.2.0
- First release: the 5-hour bar above the prompt with its time to reset, and the 7-day window beside it, on one row with Cache Maxxer's band.
