import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type agentSessionRuntimeTypes from "../core/agent-session-runtime.types.ts";
import awaitingModule from "../core/awaiting.ts";
import goalModule from "../core/goal.ts";
import outputGuard from "../core/output-guard.ts";
import platformModule from "../core/platform.ts";
import errors from "../utils/errors.ts";
import shell from "../utils/shell.ts";
import jsonEvent from "./json-event.ts";
import type printModeTypes from "./print-mode.types.ts";

const { awaited, awaiting } = awaitingModule;
const { killTrackedDetachedChildren } = shell;
const { nowMs, writeError } = platformModule;
const { flushRawStdout, waitForRawStdoutBackpressure, writeRawStdout } = outputGuard;
const { toJsonEvent } = jsonEvent;
const { describeGoalEntry, describeGoalStatus } = goalModule;
const { toErrorMessage } = errors;

const runPrintMode: {
  (
    options: printModeTypes.PrintModeOptions,
  ): (runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime) => Promise<number>;
  (
    runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime,
    options: printModeTypes.PrintModeOptions,
  ): Promise<number>;
} = dual(
  2,
  (
    runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime,
    options: printModeTypes.PrintModeOptions,
  ): Promise<number> =>
    Effect.runPromise(
      awaiting(function* () {
        const { mode, messages = [], initialMessage, initialImages } = options;
        let exitCode = 0;
        let session = runtimeHost.session;
        let unsubscribe: (() => void) | undefined;
        let unsubscribeBackpressure: (() => void) | undefined;
        let disposed = false;
        const signalCleanupHandlers: Array<() => void> = [];

        const disposeRuntime = (): Promise<void> =>
          Effect.runPromise(
            awaiting(function* () {
              if (disposed) return;
              disposed = true;
              unsubscribe?.();
              unsubscribeBackpressure?.();
              yield* awaited(runtimeHost.dispose());
            }),
          );

        const registerSignalHandlers = (): void => {
          const signals: NodeJS.Signals[] = ["SIGTERM"];
          if (process.platform !== "win32") {
            signals.push("SIGHUP");
          }

          for (const signal of signals) {
            const handler = () => {
              killTrackedDetachedChildren();
              void disposeRuntime().finally(() => {
                process.exit(signal === "SIGHUP" ? 129 : 143);
              });
            };
            process.on(signal, handler);
            signalCleanupHandlers.push(() => process.off(signal, handler));
          }
        };

        registerSignalHandlers();

        runtimeHost.setRebindSession(() =>
          Effect.runPromise(
            awaiting(function* () {
              yield* awaited(rebindSession());
            }),
          ),
        );

        const rebindSession = (): Promise<void> =>
          Effect.runPromise(
            awaiting(function* () {
              session = runtimeHost.session;
              yield* awaited(
                session.extensions.binding.bindExtensions({
                  commandContextActions: {
                    fork: (entryId, forkOptions) =>
                      Effect.runPromise(
                        awaiting(function* () {
                          const result = yield* awaited(runtimeHost.fork(entryId, forkOptions));
                          return { cancelled: result.cancelled };
                        }),
                      ),
                    navigateTree: (targetId, navigateOptions) =>
                      Effect.runPromise(
                        awaiting(function* () {
                          const result = yield* awaited(
                            session.context.tree.navigateTree(targetId, {
                              customInstructions: navigateOptions?.customInstructions,
                              label: navigateOptions?.label,
                              replaceInstructions: navigateOptions?.replaceInstructions,
                              summarize: navigateOptions?.summarize,
                            }),
                          );
                          return { cancelled: result.cancelled };
                        }),
                      ),
                    newSession: (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
                    reload: () =>
                      Effect.runPromise(
                        awaiting(function* () {
                          yield* awaited(session.extensions.runtime.reload());
                        }),
                      ),
                    switchSession: (sessionPath, switchOptions) =>
                      runtimeHost.switchSession(sessionPath, switchOptions),
                    waitForIdle: () => session.run.lifecycle.waitForIdle(),
                  },
                  mode: mode === "json" ? "json" : "print",
                  onError: (err) => {
                    writeError(`Extension error (${err.extensionPath}): ${err.error}`);
                  },
                }),
              );

              unsubscribe?.();
              unsubscribeBackpressure?.();
              unsubscribe = session.subscribe((event) => {
                if (mode === "json") {
                  writeRawStdout(`${JSON.stringify(toJsonEvent(event))}\n`);
                  return;
                }
                if (event.type === "goal_status") {
                  writeError(describeGoalStatus(event.goal, nowMs()).join("\n"));
                } else if (event.type === "memory_status") {
                  writeError(event.text);
                } else if (event.type === "entry_appended") {
                  const line = describeGoalEntry(event.entry);
                  if (line !== undefined) writeError(line.text);
                }
              });
              unsubscribeBackpressure =
                mode === "json"
                  ? session.agent.subscribe(() =>
                      Effect.runPromise(
                        awaiting(function* () {
                          yield* awaited(waitForRawStdoutBackpressure());
                        }),
                      ),
                    )
                  : undefined;
            }),
          );

        try {
          if (mode === "json") {
            const header = session.sessionManager.getHeader();
            if (header !== null) {
              writeRawStdout(`${JSON.stringify(header)}\n`);
            }
          }

          yield* awaited(rebindSession());

          if (initialMessage !== undefined && initialMessage !== "") {
            yield* awaited(session.run.prompting.prompt(initialMessage, { images: initialImages }));
          }

          for (const message of messages) {
            yield* awaited(session.run.prompting.prompt(message));
          }

          if (mode === "text") {
            const state = session.state;
            const lastMessage = state.messages[state.messages.length - 1];

            if (
              lastMessage?.role === "assistant" &&
              !writeAssistantText(lastMessage as aiTypes.AssistantMessage)
            ) {
              exitCode = 1;
            }
          }

          return exitCode;
        } catch (error: unknown) {
          writeError(toErrorMessage(error));
          return 1;
        } finally {
          for (const cleanup of signalCleanupHandlers) {
            cleanup();
          }
          yield* awaited(disposeRuntime());
          yield* awaited(flushRawStdout());
        }
      }),
    ),
);

function writeAssistantText(assistantMsg: aiTypes.AssistantMessage): boolean {
  if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
    writeError(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
    return false;
  }
  for (const content of assistantMsg.content) {
    if (content.type === "text") writeRawStdout(`${content.text}\n`);
  }
  if (assistantMsg.stopReason !== "length") return true;
  writeError("Response was truncated: the model reached its output token limit.");
  return false;
}

const printMode = {
  runPrintMode,
};

export default printMode;
