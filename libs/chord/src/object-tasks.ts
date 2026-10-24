import { Cause, Effect } from "effect";

import CtxImpl from "./ctx.ts";
import errorsModule from "./errors.ts";
import type objectTypes from "./object.types.ts";

const { ChordError } = errorsModule;

interface RunningTask {
  readonly controller: AbortController;
  readonly done: Promise<void>;
}

export default class ObjectTasks {
  readonly stopped = new Set<Promise<void>>();
  readonly #object: objectTypes.ObjectImpl;
  readonly #tasks = new Map<string, RunningTask>();
  #runs = 0;

  constructor(object: objectTypes.ObjectImpl) {
    this.#object = object;
  }

  start(): void {
    this.#runs += 1;
    const run = this.#runs;
    if (this.stopped.size === 0) {
      this.#startAll();
      return;
    }
    const deadline = this.#object.host.taskStopDeadline;
    const stopped = [...this.stopped];
    Effect.runFork(
      Effect.gen({ self: this }, function* () {
        const missed = yield* Effect.promise(() => Promise.allSettled(stopped)).pipe(
          Effect.as(false),
          Effect.timeoutOrElse({ duration: deadline, orElse: () => Effect.succeed(true) }),
        );
        if (run !== this.#runs || this.#object.status !== "live") return;
        if (missed) {
          this.#object.host.report(
            ChordError.create(
              "aborted",
              `${this.#object.address}: aborted tasks still running after ${deadline} ms; starting their replacements anyway`,
            ),
          );
        }
        this.#startAll();
      }),
    );
  }

  stop(): void {
    this.#runs += 1;
    for (const task of this.#tasks.values()) {
      task.controller.abort(ChordError.create("aborted", "task stopped"));
      const done = task.done;
      this.stopped.add(done);
      void done.finally(() => this.stopped.delete(done));
    }
    this.#tasks.clear();
  }

  #startAll(): void {
    for (const key of this.#object.decls.tasks.keys())
      this.#startTask(key, this.#object.host.currentCodeVersion());
  }

  #startTask(key: string, codeVersion: number): void {
    const object = this.#object;
    const fn = object.decls.tasks.get(key);
    if (fn === undefined) return;
    const controller = new AbortController();
    const ctx = new CtxImpl(object.host, {
      codeVersion,
      holder: true,
      principal: object.host.principal,
      rootId: `task:${object.address}:${key}`,
      signals: [controller.signal, object.callAbort.signal],
    });
    const done = Effect.runPromise(
      Effect.promise(() => Promise.resolve(fn(ctx))).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            if (!ctx.signal.aborted) object.host.report(Cause.squash(cause));
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            ctx.close();
            if (this.#tasks.get(key)?.controller === controller) this.#tasks.delete(key);
          }),
        ),
      ),
    );
    this.#tasks.set(key, { controller, done });
  }
}
