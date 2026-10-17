# Changelog

## [Unreleased]

### Added

- Long-term memory: the `memory` tool, prompt recall, and `/memory` commands keep durable facts across sessions in a local SQLite store, with embeddings from an OpenAI-compatible endpoint (local Ollama by default) and keyword search as the fallback ([docs](docs/memory.md))

## [0.0.2] - 2026-10-17

### Fixed

- `msa update` and the startup update notice read the latest version from [msa's GitHub Releases](https://github.com/masseater/msa/releases) instead of pi's, and the changelog link and binary download hint point there too
- msa no longer reports installs to pi.dev or offers the pi.dev installer, which installs pi

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/coding-agent/CHANGELOG.md).
