declare namespace modelPolicyTypes {
  interface PolicyModel {
    provider: string;
    id: string;
  }

  interface ModelPolicy {
    allow: readonly string[];
    deny: readonly string[];
  }

  type ModelPolicyDecision =
    | { allowed: true; allowedBy: string | undefined }
    | { allowed: false; reason: "deny"; pattern: string }
    | { allowed: false; reason: "not-allowed"; pattern: undefined };

  interface PolicyHiddenModel<TModel> {
    model: TModel;
    pattern: string;
    reason: "deny" | "not-allowed";
  }
}

export type { modelPolicyTypes as default };
