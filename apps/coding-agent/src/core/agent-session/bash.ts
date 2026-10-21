import * as Effect from "effect/Effect";

import type AgentSession from "../agent-session.ts";
import awaitingModule from "../awaiting.ts";
import bashExecutor from "../bash-executor.ts";
import type bashExecutorTypes from "../bash-executor.types.ts";
import type messagesTypes from "../messages.types.ts";
import platform from "../platform/index.ts";
import bashModule from "../tools/bash.ts";
import type bashTypes from "../tools/bash.types.ts";

const { nowMs } = platform;
const { awaited, awaitingWith } = awaitingModule;
const { executeBashWithOperations } = bashExecutor;
const { createLocalBashOperations } = bashModule;

export default class SessionBash {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  private readonly bashAbortControllers = new Set<AbortController>();

  private pendingBashMessages: messagesTypes.BashExecutionMessage[] = [];

  abortBash(): void {
    for (const abortController of [...this.bashAbortControllers]) {
      abortController.abort();
    }
  }

  get isBashRunning(): boolean {
    return this.bashAbortControllers.size > 0;
  }

  get hasPendingBashMessages(): boolean {
    return this.pendingBashMessages.length > 0;
  }

  flushPendingBashMessages(): void {
    if (this.pendingBashMessages.length === 0) return;

    for (const bashMessage of this.pendingBashMessages) {
      this.session.sessionManager.appendMessage(bashMessage);
    }
    this.pendingBashMessages = [];
    this.session.context.transcript.refreshFinalizedContext();
  }

  recordBashResult(
    command: string,
    result: bashExecutorTypes.BashResult,
    options?: { excludeFromContext?: boolean | undefined },
  ): void {
    const bashMessage: messagesTypes.BashExecutionMessage = {
      cancelled: result.cancelled,
      command,
      excludeFromContext: options?.excludeFromContext,
      exitCode: result.exitCode,
      fullOutputPath: result.fullOutputPath,
      output: result.output,
      role: "bashExecution",
      timestamp: nowMs(),
      truncated: result.truncated,
    };

    if (this.session.isStreaming) {
      this.pendingBashMessages.push(bashMessage);
    } else {
      this.session.sessionManager.appendMessage(bashMessage);
      this.session.context.transcript.refreshFinalizedContext();
    }
  }

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

        const prefix = this.session.settingsManager.resources.getShellCommandPrefix();
        const shellPath = this.session.settingsManager.resources.getShellPath();
        const resolvedCommand =
          prefix !== undefined && prefix !== "" ? `${prefix}\n${command}` : command;

        try {
          const result = yield* awaited(
            executeBashWithOperations(
              resolvedCommand,
              this.session.sessionManager.getCwd(),
              options?.operations ?? createLocalBashOperations({ shellPath }),
              {
                onChunk: (delta) => {
                  onChunk?.(delta);
                  this.session.emit({ delta, id: options?.id, type: "bash_execution_update" });
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
