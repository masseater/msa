import { Effect, Option } from "effect";

import type agentSessionRuntimeTypes from "../../core/agent-session-runtime.types.ts";
import awaitingModule from "../../core/awaiting.ts";
import type extensionsTypes from "../../core/extensions/index.types.ts";
import outputGuard from "../../core/output-guard.ts";
import slashCommands from "../../core/slash-commands.ts";
import themeModule from "../interactive/theme/theme.ts";
import type themeTypes from "../interactive/theme/theme.types.ts";
import jsonEvent from "../json-event.ts";
import pathModule from "../path.ts";
import jsonl from "./jsonl.ts";
import rpcModePart1 from "./rpc-mode-part1.ts";
import rpcModePart2 from "./rpc-mode-part2.ts";
import rpcModePart3Part1 from "./rpc-mode-part3-part1.ts";
import type rpcTypesTypes from "./rpc-types.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { flushRawStdout, takeOverStdout, waitForRawStdoutBackpressure } = outputGuard;
const { runRpcModePart9 } = rpcModePart1;
const { randomUuid } = pathModule;
const { theme } = themeModule;
const { toJsonEvent } = jsonEvent;
const { handleCommandPart1, runRpcModePart1, runRpcModePart3 } = rpcModePart2;
const { withSkillCommands } = slashCommands;
const { attachJsonlLineReader } = jsonl;
const { createExtensionUIContextPart1, createExtensionUIContextPart2 } = rpcModePart3Part1;

function runRpcMode(runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime): Promise<never> {
  return Effect.runPromise(
    awaiting(function* () {
      takeOverStdout();
      let session = runtimeHost.session;
      let {
        pendingExtensionRequests,
        output,
        shutdownRequested,
        unsubscribe,
        unsubscribeBackpressure,
        signalCleanupHandlers,
        success,
        error,
        shuttingDown,
      }: ReturnType<typeof runRpcModePart9> = runRpcModePart9();

      function createDialogPromise<T>(
        opts: extensionsTypes.ExtensionUIDialogOptions | undefined,
        defaultValue: T,
        request: Record<string, unknown>,
        parseResponse: (response: rpcTypesTypes.RpcExtensionUIResponse) => T,
      ): Promise<T> {
        if (opts?.signal?.aborted === true) return Promise.resolve(defaultValue);

        const id = randomUuid();
        const response = Effect.callback<T, Error>((resume) => {
          const onAbort = () => resume(Effect.succeed(defaultValue));
          opts?.signal?.addEventListener("abort", onAbort, { once: true });
          pendingExtensionRequests.set(id, {
            reject: (failure: Error) => resume(Effect.fail(failure)),
            resolve: (extensionResponse: rpcTypesTypes.RpcExtensionUIResponse) =>
              resume(Effect.succeed(parseResponse(extensionResponse))),
          });
          output({
            id,
            type: "extension_ui_request",
            ...request,
          } as rpcTypesTypes.RpcExtensionUIRequest);
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

      const createExtensionUIContext = (): extensionsTypes.ExtensionUIContext => ({
        addAutocompleteProvider(): void {},

        confirm: (title, message, opts) =>
          createDialogPromise(
            opts,
            false,
            { message, method: "confirm", timeout: opts?.timeout, title },
            (r) =>
              "cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
          ),

        custom() {
          return undefined as never;
        },

        editor(title: string, prefill?: string): Promise<string | undefined> {
          return createExtensionUIContextPart1(pendingExtensionRequests, output, prefill, title);
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
            { method: "input", placeholder, timeout: opts?.timeout, title },
            (r) =>
              "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
          ),

        notify(message: string, type?: "info" | "warning" | "error"): void {
          output({
            id: randomUuid(),
            message,
            method: "notify",
            notifyType: type,
            type: "extension_ui_request",
          } as rpcTypesTypes.RpcExtensionUIRequest);
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
            { method: "select", options, timeout: opts?.timeout, title },
            (r) =>
              "cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
          ),

        setEditorComponent(): void {},

        setEditorText(text: string): void {
          output({
            id: randomUuid(),
            method: "set_editor_text",
            text,
            type: "extension_ui_request",
          } as rpcTypesTypes.RpcExtensionUIRequest);
        },

        setFooter(_factory: unknown): void {},

        setHeader(_factory: unknown): void {},

        setHiddenThinkingLabel(_label?: string): void {},

        setStatus(key: string, text: string | undefined): void {
          output({
            id: randomUuid(),
            method: "setStatus",
            statusKey: key,
            statusText: text,
            type: "extension_ui_request",
          } as rpcTypesTypes.RpcExtensionUIRequest);
        },

        setTheme(_theme: string | themeTypes.Theme) {
          return { error: "Theme switching not supported in RPC mode", success: false };
        },

        setTitle(title: string): void {
          output({
            id: randomUuid(),
            method: "setTitle",
            title,
            type: "extension_ui_request",
          } as rpcTypesTypes.RpcExtensionUIRequest);
        },

        setToolsExpanded(_expanded: boolean) {},

        setWidget(
          key: string,
          content: unknown,
          options?: extensionsTypes.ExtensionWidgetOptions,
        ): void {
          createExtensionUIContextPart2(content, output, key, options);
        },

        setWorkingIndicator(_options?: extensionsTypes.WorkingIndicatorOptions): void {},

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
                            customInstructions: options?.customInstructions,
                            label: options?.label,
                            replaceInstructions: options?.replaceInstructions,
                            summarize: options?.summarize,
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
                    error: err.error,
                    event: err.event,
                    extensionPath: err.extensionPath,
                    type: "extension_error",
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

      const handleCommand = (
        command: rpcTypesTypes.RpcCommand,
      ): Promise<rpcTypesTypes.RpcResponse | undefined> =>
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
                return yield* handleCommandPart1(session, success, id);
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
                const commands: rpcTypesTypes.RpcSlashCommand[] = [];

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

                const skills: rpcTypesTypes.RpcSlashCommand[] = session.resourceLoader
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

      const handleInputLine = runRpcModePart1(
        output,
        error,
        pendingExtensionRequests,
        handleCommand,
        checkShutdownRequested,
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

const rpcModePart3Part2 = {
  runRpcMode,
};

export default rpcModePart3Part2;
