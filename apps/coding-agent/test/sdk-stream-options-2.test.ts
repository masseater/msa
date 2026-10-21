import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import sdkStreamOptionsSupport from "./sdk-stream-options-support.ts";

const { awaited, runTest } = testing;

const { captureStreamOptions, cleanupDirs, prepareDirs } = sdkStreamOptionsSupport;

const letsRequestTimeoutmsOverrideHttpidletimeoutmsForOpenai = () =>
  runTest(
    Effect.gen(function* () {
      const options = yield* awaited(
        captureStreamOptions(
          "openai-codex-responses",
          { httpIdleTimeoutMs: 1234 },
          { timeoutMs: 0 },
        ),
      );

      expect(options?.timeoutMs).toBe(0);
    }),
  );

const forwardsWebsocketconnecttimeoutmsFromSettings = () =>
  runTest(
    Effect.gen(function* () {
      const options = yield* awaited(
        captureStreamOptions("openai-codex-responses", {
          websocketConnectTimeoutMs: 1234,
        }),
      );

      expect(options?.websocketConnectTimeoutMs).toBe(1234);
    }),
  );

const letsRequestWebsocketconnecttimeoutmsOverrideSettings = () =>
  runTest(
    Effect.gen(function* () {
      const options = yield* awaited(
        captureStreamOptions(
          "openai-codex-responses",
          { websocketConnectTimeoutMs: 1234 },
          { websocketConnectTimeoutMs: 0 },
        ),
      );

      expect(options?.websocketConnectTimeoutMs).toBe(0);
    }),
  );

const forwardsProviderRetrySettings = () =>
  runTest(
    Effect.gen(function* () {
      const options = yield* awaited(
        captureStreamOptions("openai-completions", {
          retry: { provider: { maxRetries: 2, maxRetryDelayMs: 3000 } },
        }),
      );

      expect(options?.maxRetries).toBe(2);
      expect(options?.maxRetryDelayMs).toBe(3000);
    }),
  );

const forwardsProviderStreamEventsToExtensions = () =>
  runTest(
    Effect.gen(function* () {
      const providerEvent = { openrouter_metadata: { strategy: "direct" } };
      const extensionEvents: unknown[] = [];

      const options = yield* awaited(
        captureStreamOptions(
          "openai-completions",
          {},
          {},
          (msa) => {
            msa.on("provider_stream_event", (event) => {
              extensionEvents.push(event);
            });
          },
          providerEvent,
        ),
      );

      expect(options?.onProviderStreamEvent).toEqual(expect.any(Function));
      expect(extensionEvents).toEqual([
        {
          api: "openai-completions" as const,
          data: providerEvent,
          model: "capture-model",
          provider: "capture-provider",
          type: "provider_stream_event" as const,
        },
      ]);
    }),
  );

describe("createAgentSession stream options", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it(
    "lets request timeoutMs override httpIdleTimeoutMs for OpenAI Codex",
    letsRequestTimeoutmsOverrideHttpidletimeoutmsForOpenai,
  );

  it(
    "forwards websocketConnectTimeoutMs from settings",
    forwardsWebsocketconnecttimeoutmsFromSettings,
  );

  it(
    "lets request websocketConnectTimeoutMs override settings",
    letsRequestWebsocketconnecttimeoutmsOverrideSettings,
  );

  it("forwards provider retry settings", forwardsProviderRetrySettings);

  it("forwards provider stream events to extensions", forwardsProviderStreamEventsToExtensions);
});
