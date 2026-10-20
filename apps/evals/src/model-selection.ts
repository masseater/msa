import { dual } from "effect/Function";

export type MsaCodingAgentModelSelection = {
  provider: string;
  id: string;
};

export type ModelEnvironment = {
  MSA_PROVIDER?: string | undefined;
  MSA_MODEL?: string | undefined;
};

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

export const resolveModelSelection: {
  (
    environment: ModelEnvironment,
  ): (explicitModel: MsaCodingAgentModelSelection | undefined) => MsaCodingAgentModelSelection;
  (
    explicitModel: MsaCodingAgentModelSelection | undefined,
    environment: ModelEnvironment,
  ): MsaCodingAgentModelSelection;
} = dual(
  2,
  (
    explicitModel: MsaCodingAgentModelSelection | undefined,
    environment: ModelEnvironment,
  ): MsaCodingAgentModelSelection => {
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
