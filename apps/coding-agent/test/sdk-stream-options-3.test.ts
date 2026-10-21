import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import sdkStreamOptionsSupport from "./sdk-stream-options-support.ts";

const { awaited, runTest } = testing;

const { captureStreamOptions, cleanupDirs, prepareDirs } = sdkStreamOptionsSupport;

const runsBeforeProviderHeadersOnAssembledHeaders = () =>
  runTest(
    Effect.gen(function* () {
      const options = yield* awaited(
        captureStreamOptions(
          "openai-completions",
          {},
          { headers: { "x-explicit": "explicit" } },
          (msa) => {
            msa.on("before_provider_headers", (event) => {
              event.headers["x-hook"] = [
                event.headers["x-provider"],
                event.headers["x-model"],
                event.headers["x-explicit"],
              ].join(":");
            });
          },
        ),
      );

      expect(options?.headers).toMatchObject({
        "x-explicit": "explicit",
        "x-hook": "provider:model:explicit",
        "x-model": "model",
        "x-provider": "provider",
      });
      expect(options).not.toHaveProperty("transformHeaders");
    }),
  );

describe("createAgentSession stream options", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it(
    "runs before_provider_headers on assembled headers without forwarding the transform",
    runsBeforeProviderHeadersOnAssembledHeaders,
  );
});
