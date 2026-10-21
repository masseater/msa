import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import sdkOpenrouterAttributionSupport from "./sdk-openrouter-attribution-support.ts";

const { captureHeaders, cleanupDirs, createModel, prepareDirs } = sdkOpenrouterAttributionSupport;

const { awaited, runTest } = testing;

const addsDefaultAttributionHeadersForOpenrouterModels = Effect.gen(function* () {
  const headers = yield* awaited(
    captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1")),
  );

  expect(headers?.["HTTP-Referer"]).toBe("https://github.com/masseater/msa");
  expect(headers?.["X-OpenRouter-Title"]).toBe("msa");
  expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
});

const doesNotAddAttributionHeadersWhenTelemetry = Effect.gen(function* () {
  const headers = yield* awaited(
    captureHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
      telemetryEnabled: false,
    }),
  );

  expect(headers?.["HTTP-Referer"]).toBeUndefined();
  expect(headers?.["X-OpenRouter-Title"]).toBeUndefined();
  expect(headers?.["X-OpenRouter-Categories"]).toBeUndefined();
});

const addsAttributionHeadersForCustomProvidersRouted = Effect.gen(function* () {
  const headers = yield* awaited(
    captureHeaders(createModel("custom-openrouter", "https://openrouter.ai/api/v1")),
  );

  expect(headers?.["HTTP-Referer"]).toBe("https://github.com/masseater/msa");
  expect(headers?.["X-OpenRouter-Title"]).toBe("msa");
  expect(headers?.["X-OpenRouter-Categories"]).toBe("cli-agent");
});

describe("createAgentSession provider attribution headers", () => {
  beforeEach(() => runTest(prepareDirs));

  afterEach(() => {
    vi.stubEnv("MSA_TELEMETRY", undefined);
    return runTest(cleanupDirs);
  });

  it("adds default attribution headers for OpenRouter models", () =>
    runTest(addsDefaultAttributionHeadersForOpenrouterModels));

  it("does not add attribution headers when telemetry is disabled", () =>
    runTest(doesNotAddAttributionHeadersWhenTelemetry));

  it("adds attribution headers for custom providers routed through OpenRouter", () =>
    runTest(addsAttributionHeadersForCustomProvidersRouted));
});
