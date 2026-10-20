declare namespace modelsDevReasoningOptionsTypes {
  type ModelsDevReasoningOption =
    | { type: "toggle" }
    | {
        type: "effort";
        values: Array<
          "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "default" | null
        >;
      }
    | { type: "budget_tokens"; min?: number; max?: number };
}

export type { modelsDevReasoningOptionsTypes as default };
