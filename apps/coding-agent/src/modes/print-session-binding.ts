import { Effect } from "effect";

import type agentSessionRuntimeTypes from "../core/agent-session-runtime.types.ts";
import type agentSessionTypes from "../core/agent-session.types.ts";
import awaitingModule from "../core/awaiting.ts";
import type extensionsTypes from "../core/extensions/index.types.ts";
import outputGuard from "../core/output-guard.ts";
import platformModule from "../core/platform.ts";
import printModeOutput from "./print-mode-output.ts";
import type printModeTypes from "./print-mode.types.ts";

const { awaited, awaitingWith } = awaitingModule;

type Runtime = agentSessionRuntimeTypes.AgentSessionRuntime;
type Session = agentSessionTypes.AgentSession;
type Mode = printModeTypes.PrintModeOptions["mode"];

export default class PrintSessionBinding {
  private readonly runtimeHost: Runtime;
  private readonly mode: Mode;
  private current: Session;
  private unsubscribe: (() => void) | undefined;
  private unsubscribeBackpressure: (() => void) | undefined;
  private disposed = false;

  constructor(runtimeHost: Runtime, mode: Mode) {
    this.runtimeHost = runtimeHost;
    this.mode = mode;
    this.current = runtimeHost.session;
  }

  get session(): Session {
    return this.current;
  }

  rebind(): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.current = this.runtimeHost.session;
        yield* awaited(
          this.current.extensions.binding.bindExtensions({
            commandContextActions: this.commandContextActions(),
            mode: this.mode === "json" ? "json" : "print",
            onError: (err) => {
              platformModule.writeError(`Extension error (${err.extensionPath}): ${err.error}`);
            },
          }),
        );
        this.subscribe();
      }, this),
    );
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribeBackpressure?.();
    return this.runtimeHost.dispose();
  }

  private subscribe(): void {
    const { current, mode } = this;
    this.unsubscribe?.();
    this.unsubscribeBackpressure?.();
    this.unsubscribe = current.subscribe((event) => printModeOutput.writeSessionEvent(mode, event));
    this.unsubscribeBackpressure =
      mode === "json"
        ? current.agent.subscribe(() => outputGuard.waitForRawStdoutBackpressure())
        : undefined;
  }

  private commandContextActions(): extensionsTypes.ExtensionCommandContextActions {
    const { runtimeHost } = this;
    return {
      fork: (entryId, forkOptions) =>
        runtimeHost.fork(entryId, forkOptions).then(({ cancelled }) => ({ cancelled })),
      navigateTree: (targetId, options) =>
        this.current.context.tree
          .navigateTree(targetId, {
            customInstructions: options?.customInstructions,
            label: options?.label,
            replaceInstructions: options?.replaceInstructions,
            summarize: options?.summarize,
          })
          .then(({ cancelled }) => ({ cancelled })),
      newSession: (options) => runtimeHost.newSession(options),
      reload: () => this.current.extensions.runtime.reload(),
      switchSession: (sessionPath, options) => runtimeHost.switchSession(sessionPath, options),
      waitForIdle: () => this.current.run.lifecycle.waitForIdle(),
    };
  }
}
