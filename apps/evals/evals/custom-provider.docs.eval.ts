import { Effect } from "effect";
import { afterAll, beforeAll, beforeEach } from "vite-plus/test";
import { StructuredOutputJudge, describeEval } from "vitest-evals";

import harnessModule from "../src/harness.ts";
import acmeServer from "./acme-server.ts";
import configuredRuntime from "./configured-runtime.ts";
import type configuredRuntimeTypes from "./configured-runtime.types.ts";

const {
  STREAM_API_DOCUMENTATION,
  STREAM_MODEL_ID,
  STREAM_PROBE_PROMPT,
  STREAM_PROBE_RESPONSE,
  STREAM_PROVIDER_ID,
  createAcmeServer,
} = acmeServer;
const { inspectProvider } = configuredRuntime;
const { createMsaDocumentationEvalHarness } = harnessModule;

const DOCUMENTATION_PATH = "fixtures/acme-stream-api.json";
const STREAM_API_KEY = "resolved-stream-key";
const server = createAcmeServer("stream");

beforeAll(() => Effect.runPromise(server.start));
beforeEach(() => server.reset());
afterAll(() => Effect.runPromise(server.stop));

const expected: configuredRuntimeTypes.ProviderRuntimeOutput = {
  result: {
    model: {
      contextWindow: 16384,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: STREAM_MODEL_ID,
      input: ["text"],
      maxTokens: 2048,
      name: "Acme Stream Chat",
      provider: STREAM_PROVIDER_ID,
      reasoning: false,
    },
    response: { inputTokens: 4, outputTokens: 3, stopReason: "stop", text: STREAM_PROBE_RESPONSE },
    validRequestReceived: true,
  },
};

const harness = createMsaDocumentationEvalHarness({
  output: ({ session }) =>
    inspectProvider(session.models.selection.modelRuntime, {
      createContext: () => ({
        messages: [{ content: STREAM_PROBE_PROMPT, role: "user", timestamp: 0 }],
      }),
      modelId: STREAM_MODEL_ID,
      options: { env: { ACME_STREAM_API_KEY: STREAM_API_KEY }, maxTokens: 32 },
      providerId: STREAM_PROVIDER_ID,
      validRequestReceived: server.validRequestReceived,
    }),
  workspaceFiles: { [DOCUMENTATION_PATH]: STREAM_API_DOCUMENTATION },
});
const judge = StructuredOutputJudge({ allowExtras: false, expected, match: "strict" });

describeEval(
  "Add custom streaming provider",
  { harness, judgeThreshold: null, judges: [judge] },
  (it) => {
    it("implements a provider from an API fixture", ({ run }) =>
      run([
        {
          content: `Configure this running msa installation with Acme Stream as a provider. Do not create a project package or modify project source. Its provider ID is ${STREAM_PROVIDER_ID}, its API is at ${server.origin()}, and its API documentation is in ./${DOCUMENTATION_PATH}. Read its credential from the ACME_STREAM_API_KEY environment variable.

It offers one model, ${STREAM_MODEL_ID}, shown as “Acme Stream Chat”. The model accepts text, does not support reasoning, has a 16,384-token context window and a 2,048-token maximum output, and has no usage cost.`,
          type: "prompt",
        },
        { type: "reload" },
      ]));
  },
);
