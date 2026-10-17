import { Cause, Effect } from "effect";

import type { Connection } from "./connection.ts";
import { ChordError } from "./errors.ts";
import type { HostLinks } from "./host-links.ts";
import { beginReload, endReload, type Reload } from "./reload.ts";
import { type Frame, toWireError } from "./wire.ts";

interface ChildOperation {
  readonly id: number;
  reload: Reload | undefined;
  state: "loading" | "preparing" | "prepared";
  cancelled: boolean;
}

type PrepareFrame = Extract<Frame, { t: "prepare" }>;

export class ChildReloads {
  readonly #host: HostLinks;
  #operation: ChildOperation | undefined;

  constructor(host: HostLinks) {
    this.#host = host;
  }

  handle(
    connection: Connection,
    frame: Extract<Frame, { t: "prepare" | "commit" | "abort" }>,
  ): void {
    if (frame.t === "prepare") {
      this.#prepare(connection, frame);
      return;
    }
    const operation = this.#operation;
    if (operation === undefined || operation.id !== frame.reload) return;
    if (frame.t === "abort") {
      this.#cancel(operation);
      return;
    }
    if (operation.state !== "prepared") return;
    this.#operation = undefined;
    try {
      operation.reload?.commit();
    } finally {
      endReload(this.#host);
    }
  }

  parentLost(): void {
    if (this.#operation !== undefined) this.#cancel(this.#operation);
  }

  #prepare(connection: Connection, frame: PrepareFrame): void {
    if (this.#operation !== undefined) {
      const error = new ChordError("unavailable", "a reload is already running", {
        reason: "reload_running",
      });
      connection.send({ t: "vote", reload: frame.reload, error: toWireError(error) });
      return;
    }
    const operation: ChildOperation = {
      id: frame.reload,
      reload: undefined,
      state: "loading",
      cancelled: false,
    };
    this.#operation = operation;
    Effect.runFork(this.#run(operation, connection, frame).pipe(Effect.catchCause(this.#report)));
  }

  readonly #report = (cause: Cause.Cause<unknown>): Effect.Effect<void> =>
    Effect.sync(() => this.#host.report(Cause.squash(cause)));

  #cancel(operation: ChildOperation): void {
    operation.cancelled = true;
    const rollback = operation.reload?.rollback().pipe(Effect.catchCause(this.#report));
    if (operation.state !== "prepared") {
      if (rollback !== undefined) Effect.runFork(rollback);
      return;
    }
    this.#operation = undefined;
    if (rollback !== undefined)
      Effect.runFork(rollback.pipe(Effect.ensuring(Effect.sync(() => endReload(this.#host)))));
  }

  #run(
    operation: ChildOperation,
    connection: Connection,
    frame: PrepareFrame,
  ): Effect.Effect<void> {
    const cancelled = (): ChordError =>
      new ChordError("aborted", "reload aborted by the server", { reason: "aborted" });
    return Effect.gen({ self: this }, function* () {
      const reload = yield* beginReload(this.#host, {
        plugins: frame.plugins,
        options: frame.options,
        codeVersion: frame.codeVersion,
      });
      operation.reload = reload;
      if (operation.cancelled) throw cancelled();
      operation.state = "preparing";
      yield* reload.prepare();
      if (operation.cancelled) throw cancelled();
      operation.state = "prepared";
      connection.send({ t: "vote", reload: frame.reload, report: reload.summary() });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen({ self: this }, function* () {
          if (operation.reload !== undefined) {
            yield* operation.reload.rollback().pipe(Effect.catchCause(this.#report));
            endReload(this.#host);
          }
          if (this.#operation === operation) this.#operation = undefined;
          if (!operation.cancelled)
            connection.send({
              t: "vote",
              reload: frame.reload,
              error: toWireError(Cause.squash(cause)),
            });
        }),
      ),
    );
  }
}
