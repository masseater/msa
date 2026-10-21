import type aiTypes from "@msa/ai/index.types";

import type clientTypes from "./client.types.ts";

declare namespace providerTypes {
  interface LlamaProviderController {
    provider: aiTypes.Provider<"openai-completions">;
    setCatalog(
      models: readonly clientTypes.LlamaModelInfo[],
      serverUrl: string,
      options?: { routerAutoload?: boolean },
    ): void;
  }
}

export type { providerTypes as default };
