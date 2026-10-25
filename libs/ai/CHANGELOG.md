# Changelog

## [Unreleased]

### Added

- The `local` provider runs GGUF classifier models in process through `node-llama-cpp` (`node-llama-cpp-classify`), with Liquid D1 3B as `local/liquid-d1-3b`. A model is fetched on first use and shared by the whole process; until it is downloaded and loaded into memory, `classify` returns an error at once, and a failed fetch is retried on the next call. `ProviderClassifier.prepare` and `Provider.prepareClassifier` fetch and load a classifier model ahead of the first call and report whether it was downloaded. `download: false` in its config uses only model files already in `directory` and never downloads
- `AssistantMessage.errorStatus` holds the HTTP status of a failed request for the Anthropic, OpenAI Completions, OpenAI Responses, OpenAI Codex, and Google APIs. `isRetryableAssistantError`, the new `isProviderUnusableError`, and the new `providerUnusableReason` (`auth` or `quota`) judge a failure by this number: 429, 500, 502, 503, 504, 520, and 524 are retried, and 401, 402, and 403 mark the provider unusable and are not retried. For a message without it, they read the status from the error text only where it stands at the start or after `HTTP`, `status`, `error`, `error code`, `failed`, `returned`, `answered`, `(`, or a JSON `code`/`status` key, and only where the number is followed by the end of the text, `:`, `)`, `"`, `status code`, or an HTTP reason phrase, so a number such as `max_tokens: 402` or `error: 402 tokens requested` is not taken for a status. Without a status, a failure marks the provider unusable only when its text carries the provider's own error kind: a JSON `type`, `code`, or `status` of `authentication_error`, `permission_error`, `invalid_api_key`, `PERMISSION_DENIED`, or `UNAUTHENTICATED` for `auth`, or a quota code such as `insufficient_quota`, `billing_error`, or `payment_required` for `quota`, so `EACCES: permission denied` or `Disk quota exceeded` does not switch providers
- `AssistantMessage.errorResetsAt` holds the time, in epoch milliseconds, at which the provider said the limit behind a failed request resets. It does not change how the failure is judged; the status and the error kind still decide that

### Changed

- `stream()`, `complete()`, `streamSimple()`, and `completeSimple()` on `@msa/ai/compat` authenticate through `applyAuth`, the same path as `models.stream()`, instead of putting the provider's environment key into `apiKey`. `ANTHROPIC_AUTH_TOKEN` is sent as a bearer token, the model's `headers` and the resolved `baseUrl` are applied, and `options.signal` reaches the provider's auth resolver. When no auth resolves for a built-in provider, they no longer call the provider without a key: the request ends with `stopReason: "error"` and `Provider is not configured: <provider>`, as `models.stream()` does. The new `resolveAuth(providerOrModel, overrides)` returns the auth such a request would use

### Fixed

- OpenAI Completions requests to Ollama send `maxTokens` as `max_tokens`. Ollama ignores `max_completion_tokens`, so the limit had no effect and generation ran until the model stopped. The `ollama` provider and a `baseUrl` on port 11434 are taken as Ollama directly; for any other `baseUrl` outside OpenAI, OpenRouter, OpenCode, and Chutes, the first request with `maxTokens` reads the server root (the `baseUrl` without `/v1`) once and treats a server that answers `Ollama is running` as Ollama. The answer is kept per root for the rest of the process. `compat.maxTokensField` still overrides this and skips the check

## [0.0.1] - 2026-10-16

Forked from pi at [`4a5d372`](https://github.com/earendil-works/pi/tree/4a5d37291531ad48b8e536c892557877d219463c), after pi 1.2.0. Changes up to the fork are in [pi's changelog](https://github.com/earendil-works/pi/blob/4a5d37291531ad48b8e536c892557877d219463c/packages/ai/CHANGELOG.md).
