import { StructuredOutputJudge, describeEval } from "vitest-evals";

import { createMsaDocumentationEvalHarness } from "../src/harness.ts";
import { type AddedModelOutput, inspectAddedModel } from "./configured-runtime.ts";

const PROVIDER_ID = "openai";
const MODEL_ID = "fixture-chat";
const MODEL_NAME = "Fixture Chat";

const expected: AddedModelOutput = {
  result: {
    existingModelsPreserved: true,
    model: {
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: MODEL_ID,
      input: ["text"],
      maxTokens: 4096,
      name: MODEL_NAME,
      provider: PROVIDER_ID,
      reasoning: true,
    },
  },
};

const harness = createMsaDocumentationEvalHarness({
  output: ({ session }) => inspectAddedModel(session.modelRuntime, PROVIDER_ID, MODEL_ID),
});
const judge = StructuredOutputJudge({ allowExtras: false, expected, match: "strict" });

describeEval(
  "Add model to existing provider",
  { harness, judgeThreshold: null, judges: [judge] },
  (it) => {
    it("adds the model without replacing existing models", ({ run }) =>
      run([
        {
          content: `Configure this running msa installation with a new \`${PROVIDER_ID}/${MODEL_ID}\` model. Do not create project-local configuration. Show it as “${MODEL_NAME}”. It accepts text, supports reasoning, has a 32,768-token context window and a 4,096-token maximum output, and has no usage cost.`,
          type: "prompt",
        },
        { type: "reload" },
      ]));
  },
);
