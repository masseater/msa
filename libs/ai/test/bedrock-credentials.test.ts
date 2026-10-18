import { Data, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const bedrockMock = vi.hoisted(() => ({
  constructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class BedrockRuntimeServiceException extends Data.Error<{ readonly message: string }> {}

  class BedrockRuntimeClient {
    constructor(config: Record<string, unknown>) {
      bedrockMock.constructorCalls.push(config);
    }

    send(): Promise<never> {
      return Promise.reject(new Error("mock send"));
    }
  }

  class ConverseStreamCommand {
    readonly input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return {
    BedrockRuntimeClient,
    BedrockRuntimeServiceException,
    ConverseStreamCommand,
    StopReason: {
      END_TURN: "end_turn",
      STOP_SEQUENCE: "stop_sequence",
      MAX_TOKENS: "max_tokens",
      MODEL_CONTEXT_WINDOW_EXCEEDED: "model_context_window_exceeded",
      TOOL_USE: "tool_use",
    },
    CachePointType: { DEFAULT: "default" },
    CacheTTL: { ONE_HOUR: "ONE_HOUR" },
    ConversationRole: { ASSISTANT: "assistant", USER: "user" },
    ImageFormat: { JPEG: "jpeg", PNG: "png", GIF: "gif", WEBP: "webp" },
    ToolResultStatus: { ERROR: "error", SUCCESS: "success" },
  };
});

import type { BedrockOptions } from "../src/api/bedrock-converse-stream.ts";
import { stream as streamBedrock } from "../src/compat.ts";
import { getBuiltinModel } from "../src/providers/all.ts";
import type { Context, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const context: Context = {
  messages: [{ role: "user", content: "hello", timestamp: currentTimeMillis() }],
};

const captureClientConfig = Effect.fn("captureClientConfig")(function* (
  model: Model<"bedrock-converse-stream">,
  options: BedrockOptions = {},
) {
  bedrockMock.constructorCalls.length = 0;
  yield* Effect.promise(() =>
    streamBedrock(model, context, { cacheRetention: "none", ...options }).result(),
  );
  expect(bedrockMock.constructorCalls).toHaveLength(1);
  const [config] = bedrockMock.constructorCalls;
  if (config === undefined) throw new Error("Expected a BedrockRuntimeClient constructor call");
  return config;
});

describe("bedrock credential priority", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("prefers explicit and scoped profiles over ambient AWS access keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE");
        vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secretexample");
        const model = getBuiltinModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");

        let config = yield* captureClientConfig(model, { profile: "explicit-profile" });

        expect(config["profile"]).toBe("explicit-profile");
        expect(config["credentials"]).toBeUndefined();

        config = yield* captureClientConfig(model, { env: { AWS_PROFILE: "scoped-profile" } });

        expect(config["profile"]).toBe("scoped-profile");
        expect(config["credentials"]).toBeUndefined();
      }),
    ));

  it("uses ambient AWS access keys when no profile is configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE");
        vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secretexample");
        const model = getBuiltinModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");

        const config = yield* captureClientConfig(model);

        expect(config["profile"]).toBeUndefined();
        expect(config["credentials"]).toEqual({
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secretexample",
        });
      }),
    ));
});

describe("bedrock credential priority", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("uses ambient AWS access keys when only an ambient profile is set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLE");
        vi.stubEnv("AWS_SECRET_ACCESS_KEY", "secretexample");
        vi.stubEnv("AWS_PROFILE", "ambient-profile");
        const model = getBuiltinModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");

        const config = yield* captureClientConfig(model);

        expect(config["profile"]).toBe("ambient-profile");
        expect(config["credentials"]).toEqual({
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "secretexample",
        });
      }),
    ));
});
