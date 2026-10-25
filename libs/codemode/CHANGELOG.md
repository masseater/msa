# Changelog

## [Unreleased]

### Changed

- The `CodemodeRuntimeError` a run fails with and the `CodemodeSourceError` that `@msa/codemode/source` throws are `Schema.TaggedError` values. `_tag`, `message` and the fields keep their names and values
- Encoding one of these errors to JSON lists its keys in the schema's order and drops keys the schema does not declare

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/codemode/CHANGELOG.md).
