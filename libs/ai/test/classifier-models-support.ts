import type typesModule from "../src/types.types.ts";
const context: typesModule.ClassifierContext = {
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
