# prompt-gauges

Two small Claude Code mods for keeping an eye on how much room you have left: one for the context window, one for the 5-hour and 7-day usage limits. They work in the terminal and in the desktop app's Code tab.

![limit-band above the prompt and context-label in the footer, in the desktop app](docs/screenshot.png)

*Above the prompt, limit-band (right) beside [Cache Maxxer](https://github.com/vayaan-labs/plugins)'s band (left, a separate mod); in the footer, context-label beside the model name.*

## context-label

The context window's fill, always visible in the prompt footer beside the model name, instead of behind a click:

```
■☐☐☐ ctx 23% · 228k/1M        Opus 5.5  Medium
```

- **The bar** is four squares over the whole window. A square fills once you are within 5 points of it: at 20%, 45%, 70% and 95%.
- **The color** of the filled squares says how much you should care:

  | Color  | From (defaults) | Why |
  |--------|-----------------|-----|
  | green  | 0 | |
  | yellow | 400k, or 100k on Haiku | each turn resends the whole context; Haiku's price per token goes up 5x past 100k (the other models price the whole window the same) |
  | orange | 70% of the way to auto-compact | getting close |
  | red    | 90% of the way to auto-compact | auto-compact is near, which can break a chat |

  Orange and red follow your session's auto-compact point (read from Claude Code, as `/context` shows it); with auto-compact off they follow the whole window.
- **The text** is the same figures as the app's own context popover, updated after every response. A fresh or just-compacted session shows nothing until its first response.

Settings, with `/config`:

```
/config context-label.yellow_at=auto|100k|200k|300k|400k|500k|off
/config context-label.orange_at=60%|70%|80%|90%|off
/config context-label.red_at=85%|90%|95%|off
/config context-label.show=bar and text|bar|text
```

## limit-band

A thin line above the prompt for the 5-hour usage window, with its percent and time to reset, and the 7-day window beside it:

```
5h ━━━━━━━━┃━━──────────  49% (2h 56m) ↑119% · 7d 31% (4d 18h)
```

The bar is colored by **pace**, not by how full it is. 49% used sounds fine, but if only 41% of the window has gone by, you are on course to hit the limit before it resets. So:

- **projected** = used % ÷ the share of the window gone by;
- **green** while on pace, **amber** from a projected 100%, **red** from a projected 125%;
- near the top the used share wins whatever the pace: **amber** from 60% used, **red** from 80%;
- `↑119%` shows the projection whenever it is 100% or more (on the 7-day window too);
- the **tick** on the bar marks where the window's clock is: a fill past the tick is ahead of pace;
- no projection in the first tenth of a window, when it would be noise; only the 80% backstop applies then.

The percents come from the last API response; the countdowns tick on their own. It shows only on a subscription with usage limits.

Pace coloring is an idea from [PCritchfield/claude-gauges](https://github.com/PCritchfield/claude-gauges) (MIT), whose status line and session pane color plan limits the same way; this is its own implementation for the band above the prompt.

It shares its row with [Cache Maxxer](https://github.com/vayaan-labs/plugins)'s band when that mod is installed (and moves under it while Cache Maxxer's detail is open); without it, it takes the row by itself.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install context-label --marketplace pdrive/prompt-gauges
/plugin install limit-band --marketplace pdrive/prompt-gauges
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install context-label --marketplace pdrive/prompt-gauges
claude plugin install limit-band --marketplace pdrive/prompt-gauges
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `pdrive/prompt-gauges`, then **Add plugin**.

## Notes

- In the desktop app the footer slot is text only and cut at a fixed width, which is why context-label's bar is made of characters and kept short.
- Each mod has tests: `claude plugin test plugins/context-label`.

## License

MIT
