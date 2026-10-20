import * as Effect from "effect/Effect";

import AgentSessionLayer29 from "./agent-session-layer-29.ts";
import awaitingModule from "./awaiting.ts";
import bashExecutor from "./bash-executor.ts";
import type bashExecutorTypes from "./bash-executor.types.ts";
import bashModule from "./tools/bash.ts";
import type bashTypes from "./tools/bash.types.ts";

const { awaited, awaitingWith } = awaitingModule;
const { executeBashWithOperations } = bashExecutor;
const { createLocalBashOperations } = bashModule;

export default abstract class AgentSessionLayer30 extends AgentSessionLayer29 {
  executeBash(
    command: string,
    onChunk?: (chunk: string) => void,
    options?: {
      excludeFromContext?: boolean | undefined;
      id?: string | undefined;
      operations?: bashTypes.BashOperations | undefined;
    },
  ): Promise<bashExecutorTypes.BashResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const abortController = new AbortController();
        this.bashAbortControllers.add(abortController);

        const prefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const resolvedCommand =
          prefix !== undefined && prefix !== "" ? `${prefix}\n${command}` : command;

        try {
          const result = yield* awaited(
            executeBashWithOperations(
              resolvedCommand,
              this.sessionManager.getCwd(),
              options?.operations ?? createLocalBashOperations({ shellPath }),
              {
                onChunk: (delta) => {
                  onChunk?.(delta);
                  this.emit({ delta, id: options?.id, type: "bash_execution_update" });
                },
                signal: abortController.signal,
              },
            ),
          );

          this.recordBashResult(command, result, options);
          return result;
        } finally {
          this.bashAbortControllers.delete(abortController);
        }
      }, this),
    );
  }
}
