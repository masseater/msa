# Changelog

## [Unreleased]

### Changed

- Links deflate large payloads only when given a `compression`: `ipcLink`, `memoryLinkPair`, `webSocketLink`, `acceptWebSockets` and `forkDriver` take `{ compression }`, and `@msa/chord/node` exports `zlibCompression`. `inflateMessage` takes the compression as its second argument. The main entry no longer looks up `node:zlib` at run time ([guide](docs/guide.md#hosts-and-links))

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/chord/CHANGELOG.md).
