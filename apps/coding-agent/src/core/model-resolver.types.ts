import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

declare namespace modelResolverTypes {
  interface ScopedModel {
    model: aiTypes.Model<aiTypes.Api>;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  }

  interface ModelReferenceRequest {
    text: string;
    provider?: string | undefined;
    thinkingSuffix: "none" | "strict" | "lenient";
    fuzzy: boolean;
  }

  type ModelReferenceResult =
    | {
        status: "resolved";
        model: aiTypes.Model<aiTypes.Api>;
        thinkingLevel?: agentTypes.ThinkingLevel | undefined;
        warning?: string;
      }
    | {
        status: "ambiguous";
        candidates: aiTypes.Model<aiTypes.Api>[];
        usableCount: number;
        thinkingLevel?: agentTypes.ThinkingLevel | undefined;
        warning?: string;
      }
    | {
        status: "not-found";
        target?: ModelReferenceTarget;
      };

  interface ModelReferenceTarget {
    provider: string;
    providerModels: [aiTypes.Model<aiTypes.Api>, ...aiTypes.Model<aiTypes.Api>[]];
    modelText: string;
    modelId: string;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
  }

  interface ModelScopeDiagnostic {
    type: "warning";
    code: "no-match" | "invalid-thinking-level" | "ambiguous";
    message: string;
    pattern: string;
  }

  interface ResolveModelScopeResult {
    scopedModels: ScopedModel[];
    diagnostics: ModelScopeDiagnostic[];
  }

  interface ResolveCliModelResult {
    model: aiTypes.Model<aiTypes.Api> | undefined;
    thinkingLevel?: agentTypes.ThinkingLevel | undefined;
    warning: string | undefined;
    error: string | undefined;
  }

  interface InitialModelResult {
    model: aiTypes.Model<aiTypes.Api> | undefined;
    thinkingLevel: agentTypes.ThinkingLevel;
    fallbackMessage: string | undefined;
  }
}

export type { modelResolverTypes as default };
