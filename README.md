# pi-markdown-blocks

Polished, theme-aware fenced Markdown blocks for [Pi](https://github.com/earendil-works/pi), with syntax highlighting and clean clipboard support.

```text
╭─ ts ───────────────────────────────────────────────────────╮
│ const greeting = (name: string) => `Hello, ${name}!`;      │
│ console.log(greeting("Pi"));                               │
╰────────────────────────────────────────────────────────────╯
```

## Features

- Rounded, theme-aware frames with syntax highlighting
- Visible language labels; unlabeled fences display `text`
- Transparent background and zero outer margin by default
- Clean wrapping and narrow-terminal support
- Improved shell command and flag highlighting
- Alt+C picker for blocks in the latest assistant response
- `/copyblock [n]` command for direct, numbered copying
- Copies raw code only—no borders, labels, padding, or backticks
- Restores blocks after restart, resume, tree navigation, and `/reload`
- Cross-platform clipboard support through Pi

## Install

```bash
pi install git:github.com/FasalZein/pi-markdown-blocks
```

Restart Pi after installation. Run `/reload` after updating the extension.

## Copy a block

Press **Alt+C** to select a fenced block from the latest assistant response. Use `/copyblock [n]` when Alt shortcuts are unavailable or you already know the block number.

```text
/copyblock       Copy the first block
/copyblock 3     Copy the third block
```

The picker includes fenced blocks only. Surrounding paragraphs, headings, lists, tables, and rules are excluded.

## Configuration

| Variable | Value | Default | Description |
| --- | --- | --- | --- |
| `PI_CODEBLOCKS_BG` | `1` | off | Enable a theme-derived background |
| `PI_CODEBLOCKS_BG_COLOR` | `r;g;b` | theme | Override the enabled background color |
| `PI_CODEBLOCKS_MARGIN` | integer | `0` | Add equal left and right margins |
| `PI_CODEBLOCKS_BORDER_COLOR` | `r;g;b` | theme | Override the frame color |

RGB channels must be integers from `0` to `255`. Invalid values safely fall back to theme defaults. Margins are removed automatically when the pane is too narrow.

```bash
PI_CODEBLOCKS_BG=1 pi
PI_CODEBLOCKS_BG=1 PI_CODEBLOCKS_BG_COLOR='24;28;40' pi
PI_CODEBLOCKS_MARGIN=2 pi
PI_CODEBLOCKS_BORDER_COLOR='90;110;150' pi
```

## Theme behavior

The frame uses Pi's `mdCodeBlockBorder` token and the label uses the Markdown link color. No dark-only color is hardcoded. Use `PI_CODEBLOCKS_BORDER_COLOR` when a transparent terminal needs more contrast.

## Clipboard support

Pi selects the available clipboard route for macOS, Wayland, X11, Windows, Termux, or OSC 52 terminals. The clipboard is changed only after Alt+C or a copy command is used.

Mouse selection includes terminal border cells. Use Alt+C for clean code-only copying.

## Compatibility

Tested with Pi `0.80.6` and `0.81.1`. Pi currently has no public fenced-token renderer hook, so this extension checks for the private `Markdown.renderToken` capability before installing one reload-safe compatibility patch, disables it on shutdown, and restores the original renderer when it is topmost.

## Development

```bash
npm install
npm run verify
npm pack --dry-run
```

## Uninstall

```bash
pi remove git:github.com/FasalZein/pi-markdown-blocks
```

## License

MIT. Inspired by the MIT-licensed [`pi-pretty-codeblocks`](https://github.com/vvv850/pi-pretty-codeblocks).
