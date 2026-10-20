declare namespace platformTypes {
  type Sink = "stdout" | "stderr";

  interface CommandResult {
    readonly succeeded: boolean;
    readonly stdout: string;
    readonly output: string;
  }
}

export type { platformTypes as default };
