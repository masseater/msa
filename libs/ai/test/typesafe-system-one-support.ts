import type { ClassifierContext, ClassifierModel, ClassifierQuestion } from "../src/types.ts";
const model: ClassifierModel<"typesafe-system-one"> = {
  api: "typesafe-system-one",
  baseUrl: "https://api.typesafe.ai/v1/",
  contextWindow: 64000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "jev-latest",
  input: ["text"],
  name: "Jev",
  provider: "typesafe",
  type: "classifier",
};

const context: ClassifierContext = {
  questions: Object.fromEntries<ClassifierQuestion>([
    [
      "category",
      {
        criteria: Object.fromEntries([
          ["success", "Successful"],
          ["failure", "Failed"],
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

const wireAnswers = {
  approved: { noul: 0.95, type: "noul" },
  category: {
    choice: "success",
    confidence: 0.8,
    probabilities: { failure: 0.1, success: 0.9 },
    type: "choice",
  },
  satisfaction: { confidence: 0.7, score: 2, type: "score" },
};

const typesafeSystemOneSupport = {
  context,
  model,
  wireAnswers,
};

export default typesafeSystemOneSupport;
