import { Cause, Deferred, Effect, Exit } from "effect";

import agentRunModule from "./agent-run.ts";
import type agentRunTypes from "./agent-run.types.ts";
type ActiveRun = {
  done: Deferred.Deferred<void>;
  abortController: AbortController;
};

export default class AgentRuns {
  #active: ActiveRun | undefined;
  readonly #hooks: agentRunTypes.RunHooks;

  constructor(hooks: agentRunTypes.RunHooks) {
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
      if (this.#active !== undefined) return agentRunModule.busy("Agent is already processing.");
      const abortController = new AbortController();
      this.#active = { abortController, done: Deferred.makeUnsafe<void>() };
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
