import type conversationViewModelTypes from "./conversation-view-model.types.ts";

declare namespace conversationViewPlanTypes {
  interface CommitRequest {
    readonly index: number;
    readonly scenario: conversationViewModelTypes.Scenario;
  }
}

export type { conversationViewPlanTypes as default };
