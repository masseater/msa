declare namespace providerTypes {
  interface CliAgentModel {
    id: string;
    name: string;
    reasoning: boolean;
    input: ("text" | "image")[];
    contextWindow: number;
    maxTokens: number;
  }
}

export type { providerTypes as default };
