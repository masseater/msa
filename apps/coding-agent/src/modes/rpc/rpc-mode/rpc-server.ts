import { Effect } from "effect";

import type agentSessionRuntimeTypes from "../../../core/agent-session-runtime.types.ts";
import type AgentSession from "../../../core/agent-session.ts";
import awaitingModule from "../../../core/awaiting.ts";
import outputGuard from "../../../core/output-guard.ts";
import shell from "../../../utils/shell.ts";
import jsonEvent from "../../json-event.ts";
import RpcExtensionUi from "./extension-ui.ts";
import rpcInput from "./rpc-input.ts";
import rpcOutput from "./rpc-output.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { flushRawStdout, waitForRawStdoutBackpressure } = outputGuard;
const { killTrackedDetachedChildren } = shell;
const { toJsonEvent } = jsonEvent;
const { attachInput } = rpcInput;
const { output } = rpcOutput;

type BindOptions = Parameters<AgentSession["extensions"]["binding"]["bindExtensions"]>[0];

export default class RpcServer {
  readonly runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime;

  session: AgentSession;

  readonly ui = new RpcExtensionUi();

  private unsubscribe: (() => void) | undefined;

  private unsubscribeBackpressure: (() => void) | undefined;

  private shutdownRequested = false;

  private shuttingDown = false;

  private readonly signalCleanupHandlers: Array<() => void> = [];

  private detachInput: () => void = () => {};

  constructor(runtimeHost: agentSessionRuntimeTypes.AgentSessionRuntime) {
    this.runtimeHost = runtimeHost;
    this.session = runtimeHost.session;
  }

  run(): Effect.Effect<never> {
    return awaitingWith(function* () {
      this.runtimeHost.setRebindSession(() => this.rebindSession());
      yield* awaited(this.rebindSession());
      this.registerSignalHandlers();
      this.detachInput = attachInput(this);
      return yield* performed(Effect.never);
    }, this);
  }

  private commandContextActions(): NonNullable<BindOptions["commandContextActions"]> {
    const { runtimeHost } = this;
    return {
      fork: (entryId, forkOptions) =>
        runtimeHost.fork(entryId, forkOptions).then((result) => ({ cancelled: result.cancelled })),
      navigateTree: (targetId, options) =>
        this.session.context.tree
          .navigateTree(targetId, {
            customInstructions: options?.customInstructions,
            label: options?.label,
            replaceInstructions: options?.replaceInstructions,
            summarize: options?.summarize,
          })
          .then((result) => ({ cancelled: result.cancelled })),
      newSession: (options) => runtimeHost.newSession(options),
      reload: () => this.session.extensions.runtime.reload(),
      switchSession: (sessionPath, options) => runtimeHost.switchSession(sessionPath, options),
      waitForIdle: () => this.session.run.lifecycle.waitForIdle(),
    };
  }

  rebindSession(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.session = this.runtimeHost.session;
        yield* awaited(
          this.session.extensions.binding.bindExtensions({
            commandContextActions: this.commandContextActions(),
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
              this.shutdownRequested = true;
            },
            uiContext: this.ui.context(),
          }),
        );
        this.subscribe();
      }, this),
    );
  }

  private subscribe(): void {
    this.unsubscribe?.();
    this.unsubscribeBackpressure?.();
    this.unsubscribe = this.session.subscribe((event) => {
      output(toJsonEvent(event));
      if (event.type === "agent_settled") void Effect.runFork(this.checkShutdownRequested());
    });
    this.unsubscribeBackpressure = this.session.agent.subscribe(() =>
      waitForRawStdoutBackpressure(),
    );
  }

  private registerSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ["SIGTERM"];
    if (process.platform !== "win32") signals.push("SIGHUP");
    for (const signal of signals) {
      const handler = () => {
        killTrackedDetachedChildren();
        void Effect.runFork(this.shutdown(signal === "SIGHUP" ? 129 : 143, signal));
      };
      process.on(signal, handler);
      this.signalCleanupHandlers.push(() => process.off(signal, handler));
    }
  }

  shutdown(exitCode = 0, signal?: NodeJS.Signals): Effect.Effect<never> {
    return awaitingWith(function* () {
      if (this.shuttingDown) process.exit(exitCode);
      this.shuttingDown = true;
      for (const cleanup of this.signalCleanupHandlers) cleanup();
      this.unsubscribe?.();
      this.unsubscribeBackpressure?.();
      yield* awaited(this.runtimeHost.dispose());
      this.detachInput();
      process.stdin.pause();
      if (signal !== "SIGTERM") yield* awaited(flushRawStdout());
      process.exit(exitCode);
    }, this);
  }

  checkShutdownRequested(): Effect.Effect<void> {
    return awaitingWith(function* () {
      if (!this.shutdownRequested) return;
      yield* performed(this.shutdown());
    }, this);
  }
}
