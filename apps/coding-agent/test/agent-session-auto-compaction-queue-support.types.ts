declare namespace autoCompactionQueueSupportTypes {
  interface ModelMessageOptions {
    readonly errorMessage?: string;
    readonly input?: number;
    readonly output?: number;
    readonly text?: string;
    readonly timestamp?: number;
  }
}

export type { autoCompactionQueueSupportTypes as default };
