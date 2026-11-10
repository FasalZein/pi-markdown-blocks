# Changelog

## [0.1.1] - 2026-11-10

- Document that a local checkout needs `npm install`. Pi installs dependencies only for npm and git packages, so a local checkout without `node_modules` fails at startup with `Cannot find module 'marked'`.
- Test against Pi 1.5.x and update the development dependencies to Pi 1.5.2.
- Ship this changelog, so Pi shows the changes after an update.

## [0.1.0]

- First release: theme-aware fenced Markdown blocks, syntax highlighting, Alt+C and `/copyblock` copying.
