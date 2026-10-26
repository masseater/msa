# Changelog

## [Unreleased]

### Added

- `finalizeMessage` (an `AgentOptions` field and an `Agent` property) replaces a completed message before the agent records it and before any `message_end` listener runs, so every listener, `agent.state.messages`, the next request's context, `turn_end`, and `agent_end` get the same replacement. The object given to `message_start` is not rewritten ([docs](README.md))

- `streamProxy` sets `errorStatus` on the message when the proxy answers with an HTTP error, and passes on `errorStatus` from a proxy `error` event, so retry and the provider switch see the status even when the proxy's error field replaces the status line

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/agent/CHANGELOG.md).
