import { Cause, Effect } from "effect";

import type connectionTypes from "./connection.types.ts";
import errorsModule from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import type hostLinksTypes from "./host-links.types.ts";
import reloadModule from "./reload.ts";
import type reloadTypes from "./reload.types.ts";
import wire from "./wire.ts";
import type wireTypes from "./wire.types.ts";

const { beginReload, endReload } = reloadModule;
const { ChordError } = errorsModule;
const { toWireError } = wire;

interface ChildOperation {
  readonly id: number;
  reload: reloadTypes.Reload | undefined;
  state: "loading" | "preparing" | "prepared";
  cancelled: boolean;
}

type PrepareFrame = Extract<wireTypes.Frame, { t: "prepare" }>;

export default class ChildReloads {
  readonly #host: hostLinksTypes.HostLinks;
  #operation: ChildOperation | undefined;

  constructor(host: hostLinksTypes.HostLinks) {
    this.#host = host;
  }

  handle(
    connection: connectionTypes.Connection,
    frame: Extract<wireTypes.Frame, { t: "prepare" | "commit" | "abort" }>,
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

  #prepare(connection: connectionTypes.Connection, frame: PrepareFrame): void {
    if (this.#operation !== undefined) {
      const error = ChordError.create("unavailable", "a reload is already running", {
        reason: "reload_running",
      });
      connection.send({ error: toWireError(error), reload: frame.reload, t: "vote" });
      return;
    }
    const operation: ChildOperation = {
      cancelled: false,
      id: frame.reload,
      reload: undefined,
      state: "loading",
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
    connection: connectionTypes.Connection,
    frame: PrepareFrame,
  ): Effect.Effect<void> {
    const cancelled = (): errorsTypes.ChordError =>
      ChordError.create("aborted", "reload aborted by the server", { reason: "aborted" });
    return Effect.gen({ self: this }, function* () {
      const reload = yield* beginReload(this.#host, {
        codeVersion: frame.codeVersion,
        options: frame.options,
        plugins: frame.plugins,
      });
      operation.reload = reload;
      if (operation.cancelled) throw cancelled();
      operation.state = "preparing";
      yield* reload.prepare();
      if (operation.cancelled) throw cancelled();
      operation.state = "prepared";
      connection.send({ reload: frame.reload, report: reload.summary(), t: "vote" });
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
              error: toWireError(Cause.squash(cause)),
              reload: frame.reload,
              t: "vote",
            });
        }),
      ),
    );
  }
}
