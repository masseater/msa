import { arch, platform, release } from "node:os";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { envValue } from "./env.ts";

const googleGenAiMock = vi.hoisted(() => ({
  constructorCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@google/genai", () => {
  class GoogleGenAI {
    models = {
      generateContentStream: async function* () {
        yield {
          responseId: "vertex-response-id",
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        };
      },
    };

    constructor(config: Record<string, unknown>) {
      googleGenAiMock.constructorCalls.push(config);
    }
  }

  return {
    GoogleGenAI,
    ResourceScope: {
      COLLECTION: "COLLECTION",
    },
    ThinkingLevel: {
      THINKING_LEVEL_UNSPECIFIED: "THINKING_LEVEL_UNSPECIFIED",
      MINIMAL: "MINIMAL",
      LOW: "LOW",
      MEDIUM: "MEDIUM",
      HIGH: "HIGH",
    },
  };
});

import { stream as streamGoogleVertex } from "../src/api/google-vertex.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const MSA_USER_AGENT = `pi (${platform()} ${release()}; ${arch()})`;
const model = getModel("google-vertex", "gemini-3-flash-preview");
const context = normalizeContext({
  messages: [{ role: "user", content: "hello", timestamp: currentTimeMillis() }],
});

const originalGoogleCloudApiKey = envValue("GOOGLE_CLOUD_API_KEY");

beforeEach(() => {
  googleGenAiMock.constructorCalls.length = 0;
  vi.stubEnv("GOOGLE_CLOUD_API_KEY", undefined);
});

afterEach(() => {
  if (originalGoogleCloudApiKey === undefined) {
    vi.stubEnv("GOOGLE_CLOUD_API_KEY", undefined);
  } else {
    vi.stubEnv("GOOGLE_CLOUD_API_KEY", originalGoogleCloudApiKey);
  }
});

describe("google-vertex api key resolution", () => {
  it("falls back to ADC when options.apiKey is a placeholder marker", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = streamGoogleVertex(model, context, {
          apiKey: "<authenticated>",
          project: "test-project",
          location: "us-central1",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
          vertexai: true,
          project: "test-project",
          location: "us-central1",
          apiVersion: "v1",
        });
        expect(googleGenAiMock.constructorCalls[0]).not.toHaveProperty("apiKey");
      }),
    ));

  it("falls back to ADC when options.apiKey is the gcp-vertex-credentials marker", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = streamGoogleVertex(model, context, {
          apiKey: "gcp-vertex-credentials",
          project: "test-project",
          location: "us-central1",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
          vertexai: true,
          project: "test-project",
          location: "us-central1",
          apiVersion: "v1",
        });
        expect(googleGenAiMock.constructorCalls[0]).not.toHaveProperty("apiKey");
      }),
    ));
});

describe("google-vertex api key resolution", () => {
  it("falls back to ADC when GOOGLE_CLOUD_API_KEY is a placeholder marker", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("GOOGLE_CLOUD_API_KEY", "<authenticated>");

        const stream = streamGoogleVertex(model, context, {
          project: "test-project",
          location: "us-central1",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
          vertexai: true,
          project: "test-project",
          location: "us-central1",
          apiVersion: "v1",
        });
        expect(googleGenAiMock.constructorCalls[0]).not.toHaveProperty("apiKey");
      }),
    ));

  it("still uses the API key client for real API keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = streamGoogleVertex(model, context, {
          apiKey: "AIzaSyExampleRealisticLookingApiKey123456",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
          vertexai: true,
          apiKey: "AIzaSyExampleRealisticLookingApiKey123456",
          apiVersion: "v1",
        });
        expect(googleGenAiMock.constructorCalls[0]).not.toHaveProperty("project");
        expect(googleGenAiMock.constructorCalls[0]).not.toHaveProperty("location");
      }),
    ));
});

describe("google-vertex api key resolution", () => {
  it("does not forward generated Vertex base URL placeholders", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = streamGoogleVertex(model, context, {
          project: "test-project",
          location: "us-central1",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]?.["httpOptions"]).toEqual({
          headers: { "User-Agent": MSA_USER_AGENT },
        });
      }),
    ));

  it("lets explicit headers override the default User-Agent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stream = streamGoogleVertex(model, context, {
          project: "test-project",
          location: "us-central1",
          headers: { "User-Agent": "custom-agent" },
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]?.["httpOptions"]).toEqual({
          headers: { "User-Agent": "custom-agent" },
        });
      }),
    ));
});

describe("google-vertex api key resolution", () => {
  it("forwards custom baseUrl to the ADC client", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const customModel: Model<"google-vertex"> = {
          ...model,
          baseUrl: "https://proxy.example.com",
        };
        const stream = streamGoogleVertex(customModel, context, {
          project: "test-project",
          location: "us-central1",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
          vertexai: true,
          project: "test-project",
          location: "us-central1",
          apiVersion: "v1",
          httpOptions: {
            baseUrl: "https://proxy.example.com",
            baseUrlResourceScope: "COLLECTION",
          },
        });
      }),
    ));
});

describe("google-vertex api key resolution", () => {
  it("forwards custom baseUrl to the API key client", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const customModel: Model<"google-vertex"> = {
          ...model,
          baseUrl: "https://proxy.example.com",
        };
        const stream = streamGoogleVertex(customModel, context, {
          apiKey: "AIzaSyExampleRealisticLookingApiKey123456",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
          vertexai: true,
          apiKey: "AIzaSyExampleRealisticLookingApiKey123456",
          apiVersion: "v1",
          httpOptions: {
            baseUrl: "https://proxy.example.com",
            baseUrlResourceScope: "COLLECTION",
          },
        });
      }),
    ));
});

describe("google-vertex api key resolution", () => {
  it("does not append apiVersion when custom baseUrl already includes one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const customModel: Model<"google-vertex"> = {
          ...model,
          baseUrl: "https://proxy.example.com/v1/projects/test-project/locations/global",
        };
        const stream = streamGoogleVertex(customModel, context, {
          project: "test-project",
          location: "us-central1",
        });

        yield* Effect.promise(() => stream.result());

        expect(googleGenAiMock.constructorCalls).toHaveLength(1);
        expect(googleGenAiMock.constructorCalls[0]).toMatchObject({
          httpOptions: {
            baseUrl: "https://proxy.example.com/v1/projects/test-project/locations/global",
            baseUrlResourceScope: "COLLECTION",
            apiVersion: "",
          },
        });
      }),
    ));
});
