declare namespace conversationViewRunTypes {
  interface FinalQueues {
    readonly finalQueueReferences: number;
    readonly finalQueuedOperationReferences: number;
    readonly finalUniqueQueuedBatches: number;
  }
}

export type { conversationViewRunTypes as default };
