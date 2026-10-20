import type chordTypes from "@msa/chord/index.types";
import type { Static } from "typebox";

import type typesModule from "../harness/types.types.ts";
import type bash from "./bash.ts";

declare namespace bashTypes {
  type BashToolInput = Static<typeof bash.bashSchema>;

  type PowerShellToolInput = Static<typeof bash.powershellSchema>;

  type ShellStructuredOutput = Static<typeof bash.shellStructuredOutputSchema>;

  interface BashExecution {
    command: string;
    cwd: string;
    env: Record<string, string>;
    inheritEnv: boolean;
  }

  type BashPrepare = (
    execution: BashExecution,
    api: typesModule.ToolExecutionApi,
    context: chordTypes.Context,
  ) => void | Promise<void>;

  interface BashToolOptions {
    commandPrefix?: string;
    prepare?: BashPrepare;
  }

  interface PowerShellToolOptions {
    commandPrefix?: string;
    prepare?: BashPrepare;
    programs?: readonly string[];
  }
}

export type { bashTypes as default };
