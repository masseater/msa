# Changelog

## [Unreleased]

### Added

- `formatAttentionAlert` rings the bell and sends OSC 9 and OSC 777 notifications, wrapped for tmux passthrough with `{ tmux: true }`
- `ProgramStatus.kind` accepts `quota`. The terminal sends a kind only when the protocol reply lists it, so a terminal that lists only the base kinds gets a plain `blocked` report

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/tui/CHANGELOG.md).
