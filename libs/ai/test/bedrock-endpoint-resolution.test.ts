import { Data, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { envValue } from "./env.ts";

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
import { getModel, stream as streamBedrock } from "../src/compat.ts";
import type { Context, Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const context: Context = {
  messages: [{ role: "user", content: "hello", timestamp: currentTimeMillis() }],
};

const originalAwsRegion = envValue("AWS_REGION");
const originalAwsDefaultRegion = envValue("AWS_DEFAULT_REGION");
const originalAwsProfile = envValue("AWS_PROFILE");

beforeEach(() => {
  bedrockMock.constructorCalls.length = 0;
  vi.stubEnv("AWS_REGION", undefined);
  vi.stubEnv("AWS_DEFAULT_REGION", undefined);
  vi.stubEnv("AWS_PROFILE", undefined);
});

afterEach(() => {
  if (originalAwsRegion === undefined) {
    vi.stubEnv("AWS_REGION", undefined);
  } else {
    vi.stubEnv("AWS_REGION", originalAwsRegion);
  }

  if (originalAwsDefaultRegion === undefined) {
    vi.stubEnv("AWS_DEFAULT_REGION", undefined);
  } else {
    vi.stubEnv("AWS_DEFAULT_REGION", originalAwsDefaultRegion);
  }

  if (originalAwsProfile === undefined) {
    vi.stubEnv("AWS_PROFILE", undefined);
  } else {
    vi.stubEnv("AWS_PROFILE", originalAwsProfile);
  }
});

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

describe("bedrock endpoint resolution", () => {
  it("assigns eu-central-1 runtime URLs to built-in EU inference profiles", () => {
    const model = getModel("amazon-bedrock", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0");

    expect(model.baseUrl).toBe("https://bedrock-runtime.eu-central-1.amazonaws.com");
  });

  it("does not pin standard AWS endpoints when AWS_REGION is configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_REGION", "us-east-2");
        const model = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");

        const config = yield* captureClientConfig(model);

        expect(config["region"]).toBe("us-east-2");
        expect(config["endpoint"]).toBeUndefined();
      }),
    ));

  it("derives region from a built-in EU endpoint when no region or profile is configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("amazon-bedrock", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0");

        const config = yield* captureClientConfig(model);

        expect(config["endpoint"]).toBe("https://bedrock-runtime.eu-central-1.amazonaws.com");
        expect(config["region"]).toBe("eu-central-1");
      }),
    ));
});

describe("bedrock endpoint resolution", () => {
  it("handles missing regions for explicit, scoped, and ambient profiles", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("amazon-bedrock", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0");

        let config = yield* captureClientConfig(model, { profile: "bedrock-profile" });

        expect(config["profile"]).toBe("bedrock-profile");
        expect(config["endpoint"]).toBe("https://bedrock-runtime.eu-central-1.amazonaws.com");
        expect(config["region"]).toBe("eu-central-1");

        config = yield* captureClientConfig(model, {
          env: { AWS_PROFILE: "scoped-bedrock-profile" },
        });

        expect(config["profile"]).toBe("scoped-bedrock-profile");
        expect(config["endpoint"]).toBe("https://bedrock-runtime.eu-central-1.amazonaws.com");
        expect(config["region"]).toBe("eu-central-1");

        vi.stubEnv("AWS_PROFILE", "ambient-bedrock-profile");
        config = yield* captureClientConfig(model);

        expect(config["profile"]).toBe("ambient-bedrock-profile");
        expect(config["endpoint"]).toBeUndefined();
        expect(config["region"]).toBeUndefined();
      }),
    ));

  it("still passes custom Bedrock endpoints through to the SDK client", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_REGION", "us-west-2");
        const baseModel = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");
        const model: Model<"bedrock-converse-stream"> = {
          ...baseModel,
          baseUrl: "https://bedrock-vpc.example.com",
        };

        const config = yield* captureClientConfig(model);

        expect(config["endpoint"]).toBe("https://bedrock-vpc.example.com");
        expect(config["region"]).toBe("us-west-2");
      }),
    ));
});

describe("bedrock endpoint resolution", () => {
  it("extracts region from inference profile ARN regardless of AWS_REGION", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_REGION", "us-east-1");
        const baseModel = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");
        const model: Model<"bedrock-converse-stream"> = {
          ...baseModel,
          id: "arn:aws:bedrock:us-west-2:123456789012:application-inference-profile/abc123",
        };

        const config = yield* captureClientConfig(model);

        expect(config["region"]).toBe("us-west-2");
      }),
    ));

  it("extracts region from GovCloud inference profile ARN", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_REGION", "us-east-1");
        const baseModel = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");
        const model: Model<"bedrock-converse-stream"> = {
          ...baseModel,
          id: "arn:aws-us-gov:bedrock:us-gov-west-1:123456789012:application-inference-profile/abc123",
        };

        const config = yield* captureClientConfig(model);

        expect(config["region"]).toBe("us-gov-west-1");
      }),
    ));
});

describe("bedrock endpoint resolution", () => {
  it("preserves ambient AWS auth for custom model IDs through compat dispatch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("AWS_PROFILE", "bedrock-profile");
        const baseModel = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");
        const model: Model<"bedrock-converse-stream"> = {
          ...baseModel,
          id: "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/example",
        };

        const config = yield* captureClientConfig(model);

        expect(config["profile"]).toBe("bedrock-profile");
        expect(config["token"]).toBeUndefined();
        expect(config["authSchemePreference"]).toBeUndefined();
      }),
    ));
});

describe("bedrock endpoint resolution", () => {
  it("uses the generic API key option as a Bedrock bearer token", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("amazon-bedrock", "us.anthropic.claude-opus-4-8");

        const config = yield* captureClientConfig(model, { apiKey: "bedrock-api-key" });

        expect(config["token"]).toEqual({ token: "bedrock-api-key" });
        expect(config["authSchemePreference"]).toEqual(["httpBearerAuth"]);
      }),
    ));
});
