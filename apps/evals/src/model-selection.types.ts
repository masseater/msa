declare namespace modelSelectionTypes {
  type MsaCodingAgentModelSelection = {
    provider: string;
    id: string;
  };

  type ModelEnvironment = {
    MSA_PROVIDER?: string | undefined;
    MSA_MODEL?: string | undefined;
  };
}

export type { modelSelectionTypes as default };
