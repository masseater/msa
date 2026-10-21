declare namespace agentSessionConcurrentSupportTypes {
  interface RunnerEvent {
    readonly type: string;
    readonly message?: { readonly role?: string };
  }

  interface RunnerHandlers {
    readonly emitMessageEnd?: (event: RunnerEvent) => Promise<undefined>;
    readonly emitToolCall?: (event: RunnerEvent) => Promise<undefined>;
  }
}

export type { agentSessionConcurrentSupportTypes as default };
