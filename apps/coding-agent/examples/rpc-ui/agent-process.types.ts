declare namespace agentProcessTypes {
  interface AgentOptions {
    readonly command: string;
    readonly args: readonly string[];
    readonly onLine: (line: string) => void;
    readonly onExit: (code: number) => void;
  }

  interface AgentHandle {
    readonly send: (message: Record<string, unknown>) => void;
    readonly isRunning: () => boolean;
    readonly stderrText: () => string;
  }
}

export type { agentProcessTypes as default };
