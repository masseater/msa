import * as Effect from "effect/Effect";

import errors from "../../utils/errors.ts";
import type AgentSession from "../agent-session.ts";
import type agentSessionTypes from "../agent-session.types.ts";
import awaitingModule from "../awaiting.ts";
import extensionsModule from "../extensions/index.ts";
import type extensionsTypes from "../extensions/index.types.ts";
import ModelRegistry from "../model-registry.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errors;
const { ExtensionRunner } = extensionsModule;

export default class SessionExtensionBinding {
  private readonly session: AgentSession;

  constructor(session: AgentSession) {
    this.session = session;
  }

  extensionRunnerInternal!: extensionsTypes.ExtensionRunner;

  extensionRunnerRef?: { current?: extensionsTypes.ExtensionRunner } | undefined;

  sessionStartEvent!: extensionsTypes.SessionStartEvent;

  extensionUIContext?: extensionsTypes.ExtensionUIContext;

  private extensionMode: extensionsTypes.ExtensionMode = "print";

  extensionCommandContextActions?: extensionsTypes.ExtensionCommandContextActions;

  extensionAbortHandler?: () => void;

  extensionShutdownHandler?: extensionsTypes.ShutdownHandler;

  extensionErrorListener?: extensionsTypes.ExtensionErrorListener;

  private extensionErrorUnsubscriber?: (() => void) | undefined;

  hasExtensionHandlers(eventType: string): boolean {
    return this.extensionRunnerInternal.hasHandlers(eventType);
  }

  applyExtensionBindings(runner: extensionsTypes.ExtensionRunner): void {
    runner.setUIContext(this.extensionUIContext, this.extensionMode);
    runner.bindCommandContext(this.extensionCommandContextActions);

    this.extensionErrorUnsubscriber?.();
    this.extensionErrorUnsubscriber =
      this.extensionErrorListener === undefined
        ? undefined
        : runner.onError(this.extensionErrorListener);
  }

  get extensionRunner(): extensionsTypes.ExtensionRunner {
    return this.extensionRunnerInternal;
  }

  reportRuntimeError(runner: extensionsTypes.ExtensionRunner, event: string) {
    return (err: unknown) =>
      runner.emitError({ error: toErrorMessage(err), event, extensionPath: "<runtime>" });
  }

  createExtensionRunner(flagValues: Map<string, boolean | string> | undefined): void {
    const extensionsResult = this.session.resourceLoader.getExtensions();
    for (const [name, value] of flagValues ?? [])
      extensionsResult.runtime.flagValues.set(name, value);
    this.extensionRunnerInternal = new ExtensionRunner(
      extensionsResult.extensions,
      extensionsResult.runtime,
      this.session.cwd,
      this.session.sessionManager,
      new ModelRegistry(this.session.models.selection.modelRuntimeInternal),
    );
    if (this.extensionRunnerRef !== undefined)
      this.extensionRunnerRef.current = this.extensionRunnerInternal;
  }

  bindExtensions(bindings: agentSessionTypes.ExtensionBindings): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (bindings.uiContext !== undefined) {
          this.extensionUIContext = bindings.uiContext;
        }
        if (bindings.mode !== undefined) {
          this.extensionMode = bindings.mode;
        }
        if (bindings.commandContextActions !== undefined) {
          this.extensionCommandContextActions = bindings.commandContextActions;
        }
        if (bindings.abortHandler !== undefined) {
          this.extensionAbortHandler = bindings.abortHandler;
        }
        if (bindings.shutdownHandler !== undefined) {
          this.extensionShutdownHandler = bindings.shutdownHandler;
        }
        if (bindings.onError !== undefined) {
          this.extensionErrorListener = bindings.onError;
        }

        this.applyExtensionBindings(this.extensionRunnerInternal);
        yield* awaited(this.extensionRunnerInternal.emit(this.sessionStartEvent));
        this.extensionRunnerInternal.reportUnhandledMcpServers();
        yield* performed(
          this.session.extensions.resources.extendResourcesFromExtensions(
            this.sessionStartEvent.reason === "reload" ? "reload" : "startup",
          ),
        );
      }, this),
    );
  }

  createReplacedSessionContext(): extensionsTypes.ReplacedSessionContext {
    const context = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(this.extensionRunnerInternal.createCommandContext()),
    ) as extensionsTypes.ReplacedSessionContext;
    context.sendMessage = (message, options) =>
      this.session.run.prompting.sendCustomMessage(message, options);
    context.sendUserMessage = (content, options) =>
      this.session.run.prompting.sendUserMessage(content, options);
    return context;
  }

  configure(config: agentSessionTypes.AgentSessionConfig): void {
    this.extensionRunnerRef = config.extensionRunnerRef;
    this.sessionStartEvent = config.sessionStartEvent ?? {
      reason: "startup",
      type: "session_start",
    };
  }

  invalidateStaleRunner(): void {
    this.extensionRunnerInternal.invalidate(
      "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
    );
  }
}
