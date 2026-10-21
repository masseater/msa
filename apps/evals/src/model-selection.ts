import { dual } from "effect/Function";

import type modelSelectionTypes from "./model-selection.types.ts";

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

const resolveModelSelection: {
  (
    environment: modelSelectionTypes.ModelEnvironment,
  ): (
    explicitModel: modelSelectionTypes.MsaCodingAgentModelSelection | undefined,
  ) => modelSelectionTypes.MsaCodingAgentModelSelection;
  (
    explicitModel: modelSelectionTypes.MsaCodingAgentModelSelection | undefined,
    environment: modelSelectionTypes.ModelEnvironment,
  ): modelSelectionTypes.MsaCodingAgentModelSelection;
} = dual(
  2,
  (
    explicitModel: modelSelectionTypes.MsaCodingAgentModelSelection | undefined,
    environment: modelSelectionTypes.ModelEnvironment,
  ): modelSelectionTypes.MsaCodingAgentModelSelection => {
    const provider = trimmed(explicitModel?.provider ?? environment.MSA_PROVIDER);
    const id = trimmed(explicitModel?.id ?? environment.MSA_MODEL);
    if (provider === undefined || id === undefined) {
      throw new Error(
        "Select a harness model explicitly or set both MSA_PROVIDER and MSA_MODEL as defaults.",
      );
    }
    return { id, provider };
  },
);

const modelSelection = {
  resolveModelSelection,
};

export default modelSelection;
