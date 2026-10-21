import type modelsGenerated from "../models.generated.ts";

declare namespace allTypes {
  type BuiltinProvider = keyof typeof modelsGenerated.MODELS;
}

export type { allTypes as default };
