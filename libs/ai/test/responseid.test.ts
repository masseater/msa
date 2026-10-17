import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions } from "../src/types.ts";
import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { envValue } from "./env.ts";
import { resolveApiKey } from "./oauth.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

const openaiCodexToken = await resolveApiKey("openai-codex");

const expectResponseId = Effect.fn("expectResponseId")(function* <TApi extends Api>(
  model: Model<TApi>,
  options: StreamOptionsWithExtras = {},
) {
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Be concise.",
    messages: [
      {
        role: "user",
        content: "Reply with exactly: response id test",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };

  const response = yield* Effect.promise(() => complete(model, context, options));

  expect(response.stopReason, response.errorMessage).not.toBe("error");
  expect(response.responseId).toBeTruthy();
  expect(typeof response.responseId).toBe("string");
});

describe("responseId E2E Tests", () => {
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Google Provider",
    () => {
      const llm = getModel("google", "gemini-2.5-flash");

      it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(expectResponseId(llm)),
      );
    },
  );

  describe("Google Vertex Provider", () => {
    const vertexProject = envValue("GOOGLE_CLOUD_PROJECT") || envValue("GCLOUD_PROJECT");
    const vertexLocation = envValue("GOOGLE_CLOUD_LOCATION");
    const vertexApiKey = envValue("GOOGLE_CLOUD_API_KEY");
    const isVertexConfigured = Boolean(vertexProject && vertexLocation);
    const vertexOptions = { project: vertexProject, location: vertexLocation } as const;
    const llm = getModel("google-vertex", "gemini-3-flash-preview");

    it.skipIf(!isVertexConfigured)(
      "should expose responseId with ADC",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(expectResponseId(llm, vertexOptions)),
    );

    it.skipIf(vertexApiKey === undefined || vertexApiKey === "")(
      "should expose responseId with API key",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(expectResponseId(llm, { apiKey: vertexApiKey! })),
    );
  });

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider",
    () => {
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
      void _compat;
      const llm: Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(expectResponseId(llm)),
      );
    },
  );
});

describe("responseId E2E Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider",
    () => {
      const llm = getModel("openai", "gpt-5-mini");

      it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(expectResponseId(llm)),
      );
    },
  );

  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider", () => {
    const llm = getModel("anthropic", "claude-sonnet-4-5");

    it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(expectResponseId(llm)),
    );
  });

  describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses Provider", () => {
    const llm = getModel("azure", "gpt-4o-mini");
    const azureDeploymentName = resolveAzureDeploymentName(llm.id);
    const azureOptions =
      azureDeploymentName !== undefined && azureDeploymentName !== ""
        ? { azureDeploymentName }
        : {};

    it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
      Effect.runPromise(expectResponseId(llm, azureOptions)),
    );
  });

  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider",
    () => {
      const llm = getModel("mistral", "devstral-medium-latest");

      it("should expose responseId", { retry: 3, timeout: 30000 }, () =>
        Effect.runPromise(expectResponseId(llm)),
      );
    },
  );
});

describe("responseId E2E Tests", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should expose responseId",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("openai-codex", "gpt-5.5");
            yield* expectResponseId(llm, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
