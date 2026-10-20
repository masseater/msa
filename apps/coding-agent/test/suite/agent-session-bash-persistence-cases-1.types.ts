declare namespace agentSessionBashPersistenceCases1Types {
  interface ControlledBashInvocation {
    signal: AbortSignal | undefined;
    finish: () => void;
  }
}

export type { agentSessionBashPersistenceCases1Types as default };
