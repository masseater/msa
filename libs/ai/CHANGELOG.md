# Changelog

## [Unreleased]

### Added

- The `local` provider runs GGUF classifier models in process through `node-llama-cpp` (`node-llama-cpp-classify`), with Liquid D1 3B as `local/liquid-d1-3b`. A model is fetched on first use and shared by the whole process; while it downloads, `classify` returns an error at once, and a failed fetch is retried on the next call. `ProviderClassifier.prepare` and `Provider.prepareClassifier` fetch and load a classifier model ahead of the first call and report whether it was downloaded

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/ai/CHANGELOG.md).
