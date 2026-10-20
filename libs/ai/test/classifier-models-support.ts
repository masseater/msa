import type { ClassifierContext } from "../src/types.ts";
const context: ClassifierContext = {
  questions: {
    approved: {
      criteria: { false: "No approval", true: "Approval" },
      instructions: "Does this express approval?",
      type: "bool",
    },
  },
  state: { text: "yes" },
};

const classifierModelsSupport = {
  context,
};

export default classifierModelsSupport;
