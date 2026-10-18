import { Cause, Deferred, Effect, Exit } from "effect";

import type { AgentListener } from "./agent-options.ts";
import { call } from "./call.ts";
import type { AgentEvent } from "./types.ts";

type ActiveRun = {
  done: Deferred.Deferred<void>;
  abortController: AbortController;
};

export interface RunHooks {
  readonly onStart: () => void;
  readonly onFailure: (error: unknown, aborted: boolean) => Effect.Effect<void>;
  readonly onFinish: () => void;
}

export const busy = (message: string): Effect.Effect<never> => Effect.die(new Error(message));

export class AgentRuns {
  #active: ActiveRun | undefined;
  readonly #hooks: RunHooks;

  constructor(hooks: RunHooks) {
    this.#hooks = hooks;
  }

  get active(): boolean {
    return this.#active !== undefined;
  }

  get signal(): AbortSignal | undefined {
    return this.#active?.abortController.signal;
  }

  abort(): void {
    this.#active?.abortController.abort();
  }

  waitForIdle(): Promise<void> {
    const run = this.#active;
    return run === undefined ? Promise.resolve() : Effect.runPromise(Deferred.await(run.done));
  }

  run(executor: (signal: AbortSignal) => Effect.Effect<unknown>): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.#active !== undefined) return busy("Agent is already processing.");
      const abortController = new AbortController();
      this.#active = { done: Deferred.makeUnsafe<void>(), abortController };
      this.#hooks.onStart();
      return executor(abortController.signal).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          this.#hooks.onFailure(Cause.squash(cause), abortController.signal.aborted),
        ),
        Effect.ensuring(Effect.sync(() => this.#finish())),
      );
    });
  }

  #finish(): void {
    this.#hooks.onFinish();
    const run = this.#active;
    this.#active = undefined;
    if (run !== undefined) Deferred.doneUnsafe(run.done, Exit.void);
  }
}

export interface ListenerNotice {
  readonly listeners: ReadonlySet<AgentListener>;
  readonly event: AgentEvent;
  readonly signal: AbortSignal | undefined;
}

export const notifyListeners = ({
  listeners,
  event,
  signal,
}: ListenerNotice): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (signal === undefined) {
      return yield* Effect.die(new Error("Agent listener invoked outside active run"));
    }
    for (const listener of listeners) {
      yield* call(() => listener(event, signal));
    }
  });
