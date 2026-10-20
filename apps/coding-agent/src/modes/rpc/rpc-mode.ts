import { Effect, Option } from "effect";

import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import { awaited, awaiting, performed } from "../../core/awaiting.ts";
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
  WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import {
  flushRawStdout,
  takeOverStdout,
  waitForRawStdoutBackpressure,
  writeRawStdout,
} from "../../core/output-guard.ts";
import { withSkillCommands } from "../../core/slash-commands.ts";
import { toErrorMessage } from "../../utils/errors.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import { toJsonEvent } from "../json-event.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type {
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  RpcSessionState,
  RpcSlashCommand,
} from "./rpc-types.ts";

export type {
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  RpcSessionState,
} from "./rpc-types.ts";
import { randomUuid } from "../path.ts";

export function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
  return Effect.runPromise(
    awaiting(function* () {
      takeOverStdout();
      let session = runtimeHost.session;
      let unsubscribe: (() => void) | undefined;
      let unsubscribeBackpressure: (() => void) | undefined;

      const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
        writeRawStdout(serializeJsonLine(obj));
      };

      const success = <T extends RpcCommand["type"]>(
        id: string | undefined,
        command: T,
        data?: object | null,
      ): RpcResponse => {
        if (data === undefined) {
          return { command, id, success: true, type: "response" } as RpcResponse;
        }
        return { command, data, id, success: true, type: "response" } as RpcResponse;
      };

      const error = (id: string | undefined, command: string, message: string): RpcResponse => ({
        command,
        error: message,
        id,
        success: false,
        type: "response",
      });

      const pendingExtensionRequests = new Map<
        string,
        { resolve: (value: any) => void; reject: (error: Error) => void }
      >();

      let shutdownRequested = false;
      let shuttingDown = false;
      const signalCleanupHandlers: Array<() => void> = [];

      function createDialogPromise<T>(
        opts: ExtensionUIDialogOptions | undefined,
        defaultValue: T,
        request: Record<string, unknown>,
        parseResponse: (response: RpcExtensionUIResponse) => T,
      ): Promise<T> {
        if (opts?.signal?.aborted === true) return Promise.resolve(defaultValue);

        const id = randomUuid();
        const response = Effect.callback<T, Error>((resume) => {
          const onAbort = () => resume(Effect.succeed(defaultValue));
          opts?.signal?.addEventListener("abort", onAbort, { once: true });
          pendingExtensionRequests.set(id, {
            reject: (failure: Error) => resume(Effect.fail(failure)),
            resolve: (extensionResponse: RpcExtensionUIResponse) =>
              resume(Effect.succeed(parseResponse(extensionResponse))),
          });
          output({ id, type: "extension_ui_request", ...request } as RpcExtensionUIRequest);
          return Effect.sync(() => {
            opts?.signal?.removeEventListener("abort", onAbort);
            pendingExtensionRequests.delete(id);
          });
        });
        const timeoutMs = opts?.timeout;
        const bounded: Effect.Effect<T, Error> =
          timeoutMs === undefined || timeoutMs === 0
            ? response
            : response.pipe(
                Effect.timeoutOption(timeoutMs),
                Effect.map(Option.getOrElse(() => defaultValue)),
              );
        return Effect.runPromise(bounded);
      }

      const createExtensionUIContext = (): ExtensionUIContext => ({
        addAutocompleteProvider(): void {},

        confirm: (title, message, opts) =>
          createDialogPromise(
            opts,
            false,
            { method: "confirm", title, message, timeout: opts?.timeout },
            (r) =>
              "cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
          ),

        custom() {
          return undefined as never;
        },

        editor(title: string, prefill?: string): Promise<string | undefined> {
          const id = randomUuid();
          return Effect.runPromise(
            Effect.callback<string | undefined, Error>((resume) => {
              pendingExtensionRequests.set(id, {
                resolve: (response: RpcExtensionUIResponse) => {
                  const text =
                    "value" in response && !("cancelled" in response && response.cancelled === true)
                      ? response.value
                      : undefined;
                  resume(Effect.succeed(text));
                },
                reject: (failure: Error) => resume(Effect.fail(failure)),
              });
              output({
                type: "extension_ui_request",
                id,
                method: "editor",
                title,
                prefill,
              } as RpcExtensionUIRequest);
            }),
          );
        },

        getAllThemes() {
          return [];
        },

        getEditorComponent() {
          return undefined;
        },

        getEditorText(): string {
          return "";
        },

        getTheme(_name: string) {
          return undefined;
        },

        getToolsExpanded() {
          return false;
        },

        input: (title, placeholder, opts) =>
          createDialogPromise(
            opts,
            undefined,
            { method: "input", title, placeholder, timeout: opts?.timeout },
            (r) =>
              "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
          ),

        notify(message: string, type?: "info" | "warning" | "error"): void {
          output({
            type: "extension_ui_request",
            id: randomUuid(),
            method: "notify",
            message,
            notifyType: type,
          } as RpcExtensionUIRequest);
        },

        onTerminalInput(): () => void {
          return () => {};
        },

        pasteToEditor(text: string): void {
          this.setEditorText(text);
        },

        select: (title, options, opts) =>
          createDialogPromise(
            opts,
            undefined,
            { method: "select", title, options, timeout: opts?.timeout },
            (r) =>
              "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
          ),

        setEditorComponent(): void {},

        setEditorText(text: string): void {
          output({
            type: "extension_ui_request",
            id: randomUuid(),
            method: "set_editor_text",
            text,
          } as RpcExtensionUIRequest);
        },

        setFooter(_factory: unknown): void {},

        setHeader(_factory: unknown): void {},

        setHiddenThinkingLabel(_label?: string): void {},

        setStatus(key: string, text: string | undefined): void {
          output({
            type: "extension_ui_request",
            id: randomUuid(),
            method: "setStatus",
            statusKey: key,
            statusText: text,
          } as RpcExtensionUIRequest);
        },

        setTheme(_theme: string | Theme) {
          return { success: false, error: "Theme switching not supported in RPC mode" };
        },

        setTitle(title: string): void {
          output({
            type: "extension_ui_request",
            id: randomUuid(),
            method: "setTitle",
            title,
          } as RpcExtensionUIRequest);
        },

        setToolsExpanded(_expanded: boolean) {},

        setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
          if (content === undefined || Array.isArray(content)) {
            output({
              type: "extension_ui_request",
              id: randomUuid(),
              method: "setWidget",
              widgetKey: key,
              widgetLines: content as string[] | undefined,
              widgetPlacement: options?.placement,
            } as RpcExtensionUIRequest);
          }
        },

        setWorkingIndicator(_options?: WorkingIndicatorOptions): void {},

        setWorkingMessage(_message?: string): void {},

        setWorkingVisible(_visible: boolean): void {},

        get theme() {
          return theme;
        },
      });

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
                commandContextActions: {
                  fork: (entryId, forkOptions) =>
                    Effect.runPromise(
                      awaiting(function* () {
                        const result = yield* awaited(runtimeHost.fork(entryId, forkOptions));
                        return { cancelled: result.cancelled };
                      }),
                    ),
                  navigateTree: (targetId, options) =>
                    Effect.runPromise(
                      awaiting(function* () {
                        const result = yield* awaited(
                          session.navigateTree(targetId, {
                            summarize: options?.summarize,
                            customInstructions: options?.customInstructions,
                            replaceInstructions: options?.replaceInstructions,
                            label: options?.label,
                          }),
                        );
                        return { cancelled: result.cancelled };
                      }),
                    ),
                  newSession: (options) => runtimeHost.newSession(options),
                  reload: () =>
                    Effect.runPromise(
                      awaiting(function* () {
                        yield* awaited(session.reload());
                      }),
                    ),
                  switchSession: (sessionPath, options) =>
                    runtimeHost.switchSession(sessionPath, options),
                  waitForIdle: () => session.waitForIdle(),
                },
                mode: "rpc",
                onError: (err) => {
                  output({
                    type: "extension_error",
                    extensionPath: err.extensionPath,
                    event: err.event,
                    error: err.error,
                  });
                },
                shutdownHandler: () => {
                  shutdownRequested = true;
                },
                uiContext: createExtensionUIContext(),
              }),
            );

            unsubscribe?.();
            unsubscribeBackpressure?.();
            unsubscribe = session.subscribe((event) => {
              output(toJsonEvent(event));
              if (event.type === "agent_settled") {
                void Effect.runFork(checkShutdownRequested());
              }
            });
            unsubscribeBackpressure = session.agent.subscribe(() =>
              Effect.runPromise(
                awaiting(function* () {
                  yield* awaited(waitForRawStdoutBackpressure());
                }),
              ),
            );
          }),
        );

      yield* performed(runRpcModePart3(shutdown, signalCleanupHandlers, rebindSession));

      const handleCommand = (command: RpcCommand): Promise<RpcResponse | undefined> =>
        Effect.runPromise(
          awaiting(function* () {
            const id = command.id;

            switch (command.type) {
              case "prompt": {
                let preflightSucceeded = false;
                void session
                  .prompt(command.message, {
                    images: command.images,
                    mode: command.mode,
                    preflightResult: (disposition) => {
                      preflightSucceeded = true;
                      output(success(id, "prompt", { disposition }));
                    },
                    source: "rpc",
                    streamingBehavior: command.streamingBehavior,
                  })
                  .catch((e) => {
                    if (!preflightSucceeded) {
                      output(error(id, "prompt", e.message));
                    }
                  });
                return undefined;
              }

              case "steer": {
                const disposition = yield* awaited(
                  session.steer(command.message, command.images, { source: "rpc" }),
                );
                return success(id, "steer", { disposition });
              }

              case "follow_up": {
                const disposition = yield* awaited(
                  session.followUp(command.message, command.images, {
                    source: "rpc",
                  }),
                );
                return success(id, "follow_up", { disposition });
              }

              case "abort": {
                yield* awaited(session.abort());
                return success(id, "abort");
              }

              case "clear_queue": {
                return success(id, "clear_queue", session.clearQueue());
              }

              case "new_session": {
                const options =
                  command.parentSession !== undefined && command.parentSession !== ""
                    ? { parentSession: command.parentSession }
                    : undefined;
                const result = yield* awaited(runtimeHost.newSession(options));
                if (!result.cancelled) {
                  yield* awaited(rebindSession());
                }
                return success(id, "new_session", result);
              }

              case "get_state": {
                const usage = session.getContextUsage();
                const breakdown =
                  usage === undefined ? undefined : yield* awaited(session.getContextBreakdown());
                const state: RpcSessionState = {
                  autoCompactionEnabled: session.autoCompactionEnabled,
                  followUpMode: session.followUpMode,
                  isCompacting: session.isCompacting,
                  isStreaming: session.isStreaming,
                  messageCount: session.messages.length,
                  model: session.model,
                  pendingMessageCount: session.pendingMessageCount,
                  sessionFile: session.sessionFile,
                  sessionId: session.sessionId,
                  sessionName: session.sessionName,
                  steeringMode: session.steeringMode,
                  thinkingLevel: session.thinkingLevel,
                  ...(usage !== undefined && breakdown !== undefined
                    ? {
                        contextUsage: {
                          breakdown,
                          contextWindow: usage.contextWindow,
                          percent: (breakdown.tokens / usage.contextWindow) * 100,
                          tokens: breakdown.tokens,
                        },
                      }
                    : {}),
                };
                return success(id, "get_state", state);
              }

              case "set_model": {
                const models = session.modelRuntime.getAvailableSnapshot();
                const model = models.find(
                  (m) => m.provider === command.provider && m.id === command.modelId,
                );
                if (model === undefined) {
                  return error(
                    id,
                    "set_model",
                    `Model not found: ${command.provider}/${command.modelId}`,
                  );
                }
                yield* awaited(session.setModel(model));
                return success(id, "set_model", model);
              }

              case "cycle_model": {
                const result = yield* awaited(session.cycleModel());
                if (result === undefined) {
                  return success(id, "cycle_model", null);
                }
                return success(id, "cycle_model", result);
              }

              case "get_available_models": {
                const models = session.modelRuntime.getAvailableSnapshot();
                return success(id, "get_available_models", { models });
              }

              case "set_thinking_level": {
                session.setThinkingLevel(command.level);
                return success(id, "set_thinking_level");
              }

              case "cycle_thinking_level": {
                const level = session.cycleThinkingLevel();
                if (level === undefined) {
                  return success(id, "cycle_thinking_level", null);
                }
                return success(id, "cycle_thinking_level", { level });
              }

              case "get_available_thinking_levels": {
                const levels = session.getAvailableThinkingLevels();
                return success(id, "get_available_thinking_levels", { levels });
              }

              case "set_steering_mode": {
                session.setSteeringMode(command.mode);
                return success(id, "set_steering_mode");
              }

              case "set_follow_up_mode": {
                session.setFollowUpMode(command.mode);
                return success(id, "set_follow_up_mode");
              }

              case "compact": {
                const result = yield* awaited(session.compact(command.customInstructions));
                return success(id, "compact", result);
              }

              case "set_auto_compaction": {
                session.setAutoCompactionEnabled(command.enabled);
                return success(id, "set_auto_compaction");
              }

              case "set_auto_retry": {
                session.setAutoRetryEnabled(command.enabled);
                return success(id, "set_auto_retry");
              }

              case "abort_retry": {
                session.abortRetry();
                return success(id, "abort_retry");
              }

              case "bash": {
                const eventResult = yield* awaited(
                  session.extensionRunner.emitUserBash({
                    command: command.command,
                    cwd: session.sessionManager.getCwd(),
                    excludeFromContext: command.excludeFromContext ?? false,
                    type: "user_bash",
                  }),
                );

                if (eventResult?.result !== undefined) {
                  session.recordBashResult(command.command, eventResult.result, {
                    excludeFromContext: command.excludeFromContext,
                  });
                  return success(id, "bash", eventResult.result);
                }

                const result = yield* awaited(
                  session.executeBash(command.command, undefined, {
                    excludeFromContext: command.excludeFromContext,
                    id,
                    operations: eventResult?.operations,
                  }),
                );
                return success(id, "bash", result);
              }

              case "abort_bash": {
                session.abortBash();
                return success(id, "abort_bash");
              }

              case "get_session_stats": {
                const stats = session.getSessionStats();
                return success(id, "get_session_stats", stats);
              }

              case "export_html": {
                const path = yield* awaited(session.exportToHtml(command.outputPath));
                return success(id, "export_html", { path });
              }

              case "switch_session": {
                const result = yield* awaited(runtimeHost.switchSession(command.sessionPath));
                if (!result.cancelled) {
                  yield* awaited(rebindSession());
                }
                return success(id, "switch_session", result);
              }

              case "fork": {
                const result = yield* awaited(runtimeHost.fork(command.entryId));
                if (!result.cancelled) {
                  yield* awaited(rebindSession());
                }
                return success(id, "fork", {
                  cancelled: result.cancelled,
                  text: result.selectedText,
                });
              }

              case "clone": {
                const leafId = session.sessionManager.getLeafId();
                if (leafId === null || leafId === "") {
                  return error(id, "clone", "Cannot clone session: no current entry selected");
                }
                const result = yield* awaited(runtimeHost.fork(leafId, { position: "at" }));
                if (!result.cancelled) {
                  yield* awaited(rebindSession());
                }
                return success(id, "clone", { cancelled: result.cancelled });
              }

              case "get_fork_messages": {
                const messages = session.getUserMessagesForForking();
                return success(id, "get_fork_messages", { messages });
              }

              case "get_entries": {
                const sessionManager = session.sessionManager;
                let entries = sessionManager.getEntries();
                if (command.since !== undefined) {
                  const sinceIndex = entries.findIndex((e) => e.id === command.since);
                  if (sinceIndex === -1) {
                    return error(id, "get_entries", `Entry not found: ${command.since}`);
                  }
                  entries = entries.slice(sinceIndex + 1);
                }
                return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
              }

              case "get_tree": {
                const sessionManager = session.sessionManager;
                return success(id, "get_tree", {
                  leafId: sessionManager.getLeafId(),
                  tree: sessionManager.getTree(),
                });
              }

              case "get_last_assistant_text": {
                const text = session.getLastAssistantText();
                return success(id, "get_last_assistant_text", { text });
              }

              case "set_session_name": {
                const name = command.name.trim();
                if (name === "") {
                  return error(id, "set_session_name", "Session name cannot be empty");
                }
                session.setSessionName(name);
                return success(id, "set_session_name");
              }

              case "get_messages": {
                return success(id, "get_messages", { messages: session.messages });
              }

              case "get_commands": {
                const commands: RpcSlashCommand[] = [];

                for (const registered of session.extensionRunner.getRegisteredCommands()) {
                  commands.push({
                    description: registered.description,
                    name: registered.invocationName,
                    source: "extension",
                    sourceInfo: registered.sourceInfo,
                  });
                }

                for (const template of session.promptTemplates) {
                  commands.push({
                    description: template.description,
                    name: template.name,
                    source: "prompt",
                    sourceInfo: template.sourceInfo,
                  });
                }

                const skills: RpcSlashCommand[] = session.resourceLoader
                  .getSkills()
                  .skills.map((skill) => ({
                    description: skill.description,
                    name: skill.name,
                    source: "skill",
                    sourceInfo: skill.sourceInfo,
                  }));

                return success(id, "get_commands", {
                  commands: withSkillCommands(commands, skills),
                });
              }

              default: {
                const unknownCommand = command as { type: string };
                return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
              }
            }
          }),
        );

      let detachInput = () => {};

      function shutdown(exitCode = 0, signal?: NodeJS.Signals): Effect.Effect<never> {
        return awaiting(function* () {
          if (shuttingDown) {
            process.exit(exitCode);
          }
          shuttingDown = true;
          for (const cleanup of signalCleanupHandlers) {
            cleanup();
          }
          unsubscribe?.();
          unsubscribeBackpressure?.();
          yield* awaited(runtimeHost.dispose());
          detachInput();
          process.stdin.pause();
          if (signal !== "SIGTERM") {
            yield* awaited(flushRawStdout());
          }
          process.exit(exitCode);
        });
      }

      function checkShutdownRequested(): Effect.Effect<void> {
        return awaiting(function* () {
          if (!shutdownRequested) return;
          yield* performed(shutdown());
        });
      }

      const handleInputLine = (line: string) =>
        Effect.runPromise(
          awaiting(function* () {
            let parsed: unknown;
            try {
              parsed = JSON.parse(line);
            } catch (parseError: unknown) {
              output(
                error(undefined, "parse", `Failed to parse command: ${toErrorMessage(parseError)}`),
              );
              yield* awaited(waitForRawStdoutBackpressure());
              return;
            }

            if (
              typeof parsed === "object" &&
              parsed !== null &&
              "type" in parsed &&
              parsed.type === "extension_ui_response"
            ) {
              const response = parsed as RpcExtensionUIResponse;
              const pending = pendingExtensionRequests.get(response.id);
              if (pending !== undefined) {
                pendingExtensionRequests.delete(response.id);
                pending.resolve(response);
              }
              return;
            }

            const command = parsed as RpcCommand;
            try {
              const response = yield* awaited(handleCommand(command));
              if (response !== undefined) {
                output(response);
                yield* awaited(waitForRawStdoutBackpressure());
              }
              yield* performed(checkShutdownRequested());
            } catch (commandError: unknown) {
              output(error(command.id, command.type, toErrorMessage(commandError)));
              yield* awaited(waitForRawStdoutBackpressure());
            }
          }),
        );

      const onInputEnd = () => {
        void Effect.runFork(shutdown());
      };
      process.stdin.on("end", onInputEnd);

      detachInput = (() => {
        const detachJsonl = attachJsonlLineReader(process.stdin, (line) => {
          void handleInputLine(line);
        });
        return () => {
          detachJsonl();
          process.stdin.off("end", onInputEnd);
        };
      })();

      return yield* performed(Effect.never);
    }),
  );
}

function runRpcModePart3(
  shutdown: (exitCode?: number, signal?: NodeJS.Signals) => Effect.Effect<never>,
  signalCleanupHandlers: (() => void)[],
  rebindSession: () => Promise<void>,
): Effect.Effect<void> {
  return awaiting(function* () {
    const registerSignalHandlers = (): void => {
      const signals: NodeJS.Signals[] = ["SIGTERM"];
      if (process.platform !== "win32") {
        signals.push("SIGHUP");
      }

      for (const signal of signals) {
        const handler = () => {
          killTrackedDetachedChildren();
          void Effect.runFork(shutdown(signal === "SIGHUP" ? 129 : 143, signal));
        };
        process.on(signal, handler);
        signalCleanupHandlers.push(() => process.off(signal, handler));
      }
    };

    yield* awaited(rebindSession());
    registerSignalHandlers();
  });
}
