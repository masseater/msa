import type decodeTypes from "../decode.types.ts";
import type executionErrorTypes from "../execution-error.types.ts";
import type resultTypes from "../result.types.ts";
import type typesModule from "../types.ts";
import type nodeChildWaitTypes from "./node-child-wait.types.ts";
import type nodeProcessTypes from "./node-process.types.ts";
import type ShellRunClass from "./node-shell-run.ts";
import type nodeSpillTypes from "./node-spill.types.ts";
import type nodeTimerTypes from "./node-timer.types.ts";

declare namespace nodeShellRunTypes {
  type OnOutput = NonNullable<typesModule.ShellExecOptions["onOutput"]>;

  type Context = Parameters<OnOutput>[1];

  interface ShellRunRequest {
    readonly program: string;
    readonly args: readonly string[];
    readonly stdinCommand: string | undefined;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly timeoutMs: number | undefined;
    readonly timeout: number | undefined;
    readonly context: Context;
    readonly onOutput: OnOutput | undefined;
    readonly spill: nodeSpillTypes.SpillThreshold | undefined;
    readonly activeChildPids: Set<number>;
    readonly createTempFile: nodeSpillTypes.SpillHooks["createTempFile"];
  }

  type ShellRun = ShellRunClass;

  type StreamDecoder = decodeTypes.StreamDecoder;

  type ExecutionError = executionErrorTypes.ExecutionError;

  type ChildExit = nodeChildWaitTypes.ChildExit;

  type OsProcess = nodeProcessTypes.OsProcess;

  type OutputSpill = nodeSpillTypes.OutputSpill;

  type Timer = nodeTimerTypes.Timer;

  type Result<TValue, TError> = resultTypes.Result<TValue, TError>;
}

export type { nodeShellRunTypes as default };
