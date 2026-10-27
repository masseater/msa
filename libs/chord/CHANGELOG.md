# Changelog

## [Unreleased]

### Changed

- The error classes `ChordError`, `PathError`, `UnsafePathError` are `Schema.TaggedError` classes. `new` takes one `{...}` object of their fields; the old positional arguments moved to the static `create(...)`, and `make({...})` builds one from the fields. `_tag`, `message` and the fields keep their names and values
- Constructing one of these errors checks its fields against the schema and throws when one does not match
- Encoding one of these errors to JSON lists its keys in the schema's order and drops keys the schema does not declare
- Links deflate large payloads only when given a `compression`: `ipcLink`, `memoryLinkPair`, `webSocketLink`, `acceptWebSockets` and `forkDriver` take `{ compression }`, and `@msa/chord/node` exports `zlibCompression`. `inflateMessage` takes the compression as its second argument. The main entry no longer looks up `node:zlib` at run time ([guide](docs/guide.md#hosts-and-links))

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/chord/CHANGELOG.md).
