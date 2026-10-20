import type typesModule from "../src/types.types.ts";
const model: typesModule.ClassifierModel<"openai-decisions"> = {
  api: "openai-decisions",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 922000,
  cost: {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0.1,
    output: 0,
    tiers: [{ cacheRead: 0, cacheWrite: 0, input: 0.2, inputTokensAbove: 272000, output: 0 }],
  },
  id: "gpt-6-luna",
  input: ["text", "image"],
  name: "GPT-6 Luna",
  provider: "openai",
  type: "classifier",
};

const context: typesModule.ClassifierContext = {
  questions: Object.fromEntries<typesModule.ClassifierQuestion>([
    [
      "category",
      {
        criteria: Object.fromEntries([
          ["success", "Successful"],
          ["failure", ""],
        ]),
        instructions: "Classify the message",
        type: "choice",
      },
    ],
    [
      "satisfaction",
      {
        criteria: ["low", "neutral", "high"],
        instructions: "Score satisfaction",
        type: "score",
      },
    ],
    [
      "approved",
      {
        criteria: { false: "No approval", true: "Approval" },
        instructions: "Does the user approve?",
        type: "bool",
      },
    ],
  ]),
  state: { text: "The deployment succeeded, thank you." },
};

const wireAnswers = [
  {
    choice: "success",
    confidence: 0.8,
    name: "category",
    probabilities: [
      { probability: 0.9, value: "success" },
      { probability: 0.1, value: "failure" },
    ],
    type: "choice",
  },
  {
    confidence: 0.7,
    name: "satisfaction",
    probabilities: [
      { label: "low", probability: 0.05, value: 0 },
      { label: "neutral", probability: 0.1, value: 1 },
      { label: "high", probability: 0.85, value: 2 },
    ],
    score: 1.8,
    type: "score",
  },
  { name: "approved", probability: 0.95, type: "predicate" },
];

const wireUsage = {
  input_tokens: 164,
  input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 },
  output_tokens: 0,
  output_tokens_details: { reasoning_tokens: 0 },
  total_tokens: 164,
};

const image: typesModule.ImageContent = { data: "aW1hZ2U=", mimeType: "image/png", type: "image" };

const openaiDecisionsSupport = {
  context,
  image,
  model,
  wireAnswers,
  wireUsage,
};

export default openaiDecisionsSupport;
