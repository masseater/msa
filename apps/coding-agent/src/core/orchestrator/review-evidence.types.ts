import type decideTypes from "../decision/decide.types.ts";
import type reviewChecklistTypes from "./review-checklist.types.ts";

declare namespace reviewEvidenceTypes {
  type Evidence =
    | { kind: "unrecorded"; checklist: reviewChecklistTypes.Judgement; prompt: string }
    | {
        kind: "recorded";
        checklist: reviewChecklistTypes.Judgement;
        unchanged: boolean;
        request: decideTypes.DecideRequest;
      };
}

export type { reviewEvidenceTypes as default };
