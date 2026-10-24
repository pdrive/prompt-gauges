# Next session: open agent tasks

- [ ] **Cache Maxxer countdown fix**: when vayaan-labs/cache-maxxer#2 ships, update Cache Maxxer and check limit-band steps aside → § Cache Maxxer countdown fix
- [ ] **"1 error during load"**: confirm it is gone in a fresh session → § Load error

## Cache Maxxer countdown fix

Issue: https://github.com/vayaan-labs/cache-maxxer/issues/2 (the collapsed chip's countdown `Text` in `hooks/desktop.tsx` has no `tabular`, so it changes width every second). Until it ships, limit-band adds `tabular` to every `Text` of the band beneath it (`withTabularDigits` in `plugins/limit-band/hooks/register.tsx`).

When a fixed version is out:
1. `claude plugin update cache-maxxer@vayaan-labs`, then `/reload-plugins`.
2. Check the countdown no longer nudges the row, and that limit-band now hands the band on untouched (`setsTabular` finds their `tabular`; the test "the band beneath gets fixed-width digits" covers both cases).
3. Optional: once most users have the fix, drop `withTabularDigits` and its README line.

## Load error

`/reload-plugins` has said `1 error during load` since the session that built these mods deleted its own hot-reload mods folder mid-session; both mods load fine (`claude plugin list` shows them enabled). A fresh session should not show it. If it still does, run `/plugin` for the details.
