import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach } from "vite-plus/test";
import { StructuredOutputJudge, describeEval } from "vitest-evals";

import harnessModule from "../src/harness.ts";
import acmeServer from "./acme-server.ts";
import configuredRuntime from "./configured-runtime.ts";
import type configuredRuntimeTypes from "./configured-runtime.types.ts";

const {
  OPENAI_MODEL_ID,
  OPENAI_PROBE_PROMPT,
  OPENAI_PROBE_RESPONSE,
  OPENAI_PROVIDER_ID,
  createAcmeServer,
} = acmeServer;
const { inspectProvider } = configuredRuntime;
const { createMsaDocumentationEvalHarness } = harnessModule;

const server = createAcmeServer("openai");

beforeAll(() => Effect.runPromise(server.start));
beforeEach(() => server.reset());
afterAll(() => Effect.runPromise(server.stop));

const expected: configuredRuntimeTypes.ProviderRuntimeOutput = {
  result: {
    model: {
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: OPENAI_MODEL_ID,
      input: ["text"],
      maxTokens: 4096,
      name: "Acme Chat",
      provider: OPENAI_PROVIDER_ID,
      reasoning: false,
    },
    response: { inputTokens: 3, outputTokens: 2, stopReason: "stop", text: OPENAI_PROBE_RESPONSE },
    validRequestReceived: true,
  },
};

const harness = createMsaDocumentationEvalHarness({
  output: ({ session }) =>
    inspectProvider(session.modelRuntime, {
      createContext: () => ({
        messages: [{ content: OPENAI_PROBE_PROMPT, role: "user", timestamp: 0 }],
      }),
      modelId: OPENAI_MODEL_ID,
      options: { env: { ACME_API_KEY: "resolved-acme-key" }, maxTokens: 32 },
      providerId: OPENAI_PROVIDER_ID,
      validRequestReceived: server.validRequestReceived,
    }),
});
const judge = StructuredOutputJudge({ allowExtras: false, expected, match: "strict" });

describeEval(
  "Add OpenAI-compatible provider",
  { harness, judgeThreshold: null, judges: [judge] },
  (it) => {
    it("configures a provider that works through msa", ({ run }) =>
      run([
        {
          content: `Configure this running msa installation with Acme as a provider. Do not create project-local configuration. Its provider ID is ${OPENAI_PROVIDER_ID}, its API is at ${server.baseUrl()}, and it uses OpenAI Chat Completions. Read its API key from the ACME_API_KEY environment variable.

The provider offers one model, ${OPENAI_MODEL_ID}, shown as “Acme Chat”. It accepts text, does not support reasoning, has a 32,768-token context window and a 4,096-token maximum output, and has no usage cost.`,
          type: "prompt",
        },
        { type: "reload" },
      ]));
  },
);
