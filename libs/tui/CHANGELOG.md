# Changelog

## [Unreleased]

### Changed

- The default export is frozen with `Object.freeze`. In strict mode code (ES modules), adding a member throws `TypeError: Cannot add property <name>, object is not extensible`, replacing one throws `TypeError: Cannot assign to read only property '<name>' of object '#<Object>'`, deleting one throws `TypeError: Cannot delete property '<name>' of #<Object>`, and `Object.defineProperty` throws; `Reflect.defineProperty` returns `false`, and an assignment in sloppy mode is ignored without an error. The classes it holds are not frozen: `tui.Box.prototype.render = ...` still works in a process that only loads `@msa/tui`

### Added

- `formatAttentionAlert` rings the bell and sends OSC 9 and OSC 777 notifications, wrapped for tmux passthrough with `{ tmux: true }`
- `ProgramStatus.kind` accepts `quota`. The terminal sends a kind only when the protocol reply lists it, so a terminal that lists only the base kinds gets a plain `blocked` report

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/tui/CHANGELOG.md).
