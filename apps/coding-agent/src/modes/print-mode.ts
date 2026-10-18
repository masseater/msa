import type { AssistantMessage, ImageContent } from "@msa/ai";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { awaited, awaiting } from "../core/awaiting.ts";
import { describeGoalEntry, describeGoalStatus } from "../core/goal.ts";
import {
  flushRawStdout,
  waitForRawStdoutBackpressure,
  writeRawStdout,
} from "../core/output-guard.ts";
import { nowMs, writeError } from "../core/platform.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";
import { toJsonEvent } from "./json-event.ts";

export interface PrintModeOptions {
  mode: "text" | "json";
  messages?: string[] | undefined;
  initialMessage?: string | undefined;
  initialImages?: ImageContent[] | undefined;
}

export const runPrintMode: {
  (options: PrintModeOptions): (runtimeHost: AgentSessionRuntime) => Promise<number>;
  (runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number>;
} = dual(2, (runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> =>
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
              session.bindExtensions({
                mode: mode === "json" ? "json" : "print",
                commandContextActions: {
                  waitForIdle: () => session.waitForIdle(),
                  newSession: (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
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
                          session.navigateTree(targetId, {
                            summarize: navigateOptions?.summarize,
                            customInstructions: navigateOptions?.customInstructions,
                            replaceInstructions: navigateOptions?.replaceInstructions,
                            label: navigateOptions?.label,
                          }),
                        );
                        return { cancelled: result.cancelled };
                      }),
                    ),
                  switchSession: (sessionPath, switchOptions) =>
                    runtimeHost.switchSession(sessionPath, switchOptions),
                  reload: () =>
                    Effect.runPromise(
                      awaiting(function* () {
                        yield* awaited(session.reload());
                      }),
                    ),
                },
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
          yield* awaited(session.prompt(initialMessage, { images: initialImages }));
        }

        for (const message of messages) {
          yield* awaited(session.prompt(message));
        }

        if (mode === "text") {
          const state = session.state;
          const lastMessage = state.messages[state.messages.length - 1];

          if (lastMessage?.role === "assistant") {
            const assistantMsg = lastMessage as AssistantMessage;
            if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
              writeError(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
              exitCode = 1;
            } else {
              for (const content of assistantMsg.content) {
                if (content.type === "text") {
                  writeRawStdout(`${content.text}\n`);
                }
              }
              if (assistantMsg.stopReason === "length") {
                writeError("Response was truncated: the model reached its output token limit.");
                exitCode = 1;
              }
            }
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
