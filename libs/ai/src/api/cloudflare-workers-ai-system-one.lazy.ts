import type { ProviderClassifier } from "../types.ts";

export const cloudflareWorkersAISystemOneApi = (): ProviderClassifier => ({
  classify: (model, context, options) =>
    import("./cloudflare-workers-ai-system-one.ts").then((module) =>
      module.classify(model, context, options),
    ),
});
