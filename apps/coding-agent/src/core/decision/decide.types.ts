import type aiTypes from "@msa/ai/index.types";
import type { Effect } from "effect";

declare namespace decideTypes {
  type DecisionQuestion = aiTypes.ClassifierQuestion & { readonly threshold: number };

  interface DecideRequest {
    readonly name: string;
    readonly state: aiTypes.JsonObject;
    readonly questions: Readonly<Record<string, DecisionQuestion>>;
  }

  type DecisionAnswer =
    | { readonly type: "bool"; readonly probability: number; readonly holds: boolean }
    | {
        readonly type: "choice";
        readonly probabilities: Readonly<Record<string, number>>;
        readonly choice: string | undefined;
      }
    | {
        readonly type: "score";
        readonly score: number;
        readonly confidence: number;
        readonly level: number | undefined;
      };

  type Decision =
    | {
        readonly status: "decided";
        readonly model: string;
        readonly answers: Readonly<Record<string, DecisionAnswer>>;
      }
    | { readonly status: "undecided"; readonly reason: string };

  type DecisionModelPreparation =
    | { readonly status: "ready"; readonly model: string; readonly fetched: boolean }
    | { readonly status: "failed"; readonly model: string; readonly reason: string };

  interface DecideShape {
    readonly decide: (request: DecideRequest) => Effect.Effect<Decision>;
  }

  interface DecisionHost {
    readonly model: () =>
      | { readonly model: aiTypes.ClassifierModel<aiTypes.ClassifierApi> }
      | { readonly unavailable: string };
    readonly classify: (
      model: aiTypes.ClassifierModel<aiTypes.ClassifierApi>,
      context: aiTypes.ClassifierContext,
      signal: AbortSignal,
    ) => Promise<aiTypes.ClassifierResult>;
    readonly threshold: (key: string) => number | undefined;
    readonly recordUsage: (result: aiTypes.ClassifierResult) => void;
    readonly recordUndecided: (name: string, reason: string) => void;
  }
}

export type { decideTypes as default };
