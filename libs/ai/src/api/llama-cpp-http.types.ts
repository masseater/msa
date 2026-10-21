import type typesModule from "../types.types.ts";

declare namespace llamaCppHttpTypes {
  interface RequestContext {
    model: typesModule.ClassifierModel<typesModule.ClassifierApi>;
    root: string;
    options: typesModule.ClassifierOptions | undefined;
  }
}

export type { llamaCppHttpTypes as default };
