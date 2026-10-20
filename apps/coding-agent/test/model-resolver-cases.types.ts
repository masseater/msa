import type { ModelReferenceRequest } from "../src/core/model-resolver.ts";

declare namespace modelResolverCasesTypes {
  type ReferenceExpected =
    | { model: string; thinkingLevel?: string; warning?: string }
    | { ambiguous: string[]; usableCount: number }
    | "not-found";

  interface ReferenceCase {
    name: string;
    text: string;
    expected: ReferenceExpected;
    usable?: string[];
    provider?: string;
    thinkingSuffix?: ModelReferenceRequest["thinkingSuffix"];
    fuzzy?: boolean;
  }
}

export type { modelResolverCasesTypes as default };
