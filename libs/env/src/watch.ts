import type { Context } from "@msa/chord";
import { FileError, type FileWatcher, type WatchChange, type WatchTarget } from "@msa/durable/env";
import { Cause, Deferred, Effect, Exit } from "effect";

import { type Connection, isConnectionLost, type Json } from "./connection.ts";
import { toFileError } from "./errors.ts";

export interface RemoteWatchOptions {
  mode?: "native" | "polling";
  pollIntervalMs?: number;
  maxDirectories?: number;
}

const RECONNECT_FIRST_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

function unrefTimer(delay: number, fire: () => void): () => void {
  const timer = setTimeout(fire, delay);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}

export class RemoteWatcher implements FileWatcher {
  readonly #connection: Connection;
  readonly #targets: readonly WatchTarget[];
  readonly #onChange: (change: WatchChange) => void;
  readonly #options: RemoteWatchOptions;
  #mode: "native" | "polling" = "native";
  #closed = false;
  #controller: AbortController | undefined;
  #request: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  private constructor(
    connection: Connection,
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    options: RemoteWatchOptions,
  ) {
    this.#connection = connection;
    this.#targets = targets;
    this.#onChange = onChange;
    this.#options = options;
  }

  static open(
    connection: Connection,
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    options: RemoteWatchOptions = {},
  ): Promise<RemoteWatcher> {
    const watcher = new RemoteWatcher(connection, targets, onChange, options);
    return Effect.runPromise(Effect.as(watcher.#start(), watcher));
  }

  get mode(): "native" | "polling" {
    return this.#mode;
  }

  close(_context: Context): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#wake?.();
    this.#controller?.abort();
    return this.#request ?? Promise.resolve();
  }

  #deliver(change: WatchChange): boolean {
    if (this.#closed) return false;
    try {
      this.#onChange(change);
      return true;
    } catch {
      return false;
    }
  }

  #onEvent(event: Json, onReady: () => void): void {
    if (event["kind"] === "ready") {
      this.#mode = event["mode"] === "polling" ? "polling" : "native";
      onReady();
    } else if (event["kind"] === "change") {
      if (event["mode"] === "polling") this.#mode = "polling";
      if (event["overflow"] === true) this.#deliver({ overflow: true });
      else this.#deliver({ paths: event["paths"] as string[] });
    } else if (event["kind"] === "error") {
      const code = event["code"] === "permission_denied" ? "permission_denied" : "invalid";
      this.#deliver({ error: new FileError(code, String(event["message"])) });
      this.#closed = true;
    }
  }

  #onFailure(error: unknown, ready: boolean, started: Deferred.Deferred<void, Error>): void {
    if (!ready) {
      Deferred.doneUnsafe(started, Exit.fail(asError(error)));
      return;
    }
    if (this.#closed) return;
    if (isConnectionLost(error)) {
      Effect.runFork(this.#reconnect());
      return;
    }
    this.#deliver({ error: toFileError(error, undefined) });
    this.#closed = true;
  }

  #start(): Effect.Effect<void, Error> {
    let ready = false;
    const started = Deferred.makeUnsafe<void, Error>();
    const controller = new AbortController();
    this.#controller = controller;
    const request = this.#connection.request(
      "watch",
      {
        targets: this.#targets.map((target) => ({
          path: target.path,
          recursive: target.recursive === true,
          exclude: {
            hidden: target.exclude?.hidden === true,
            names: [...(target.exclude?.names ?? [])],
          },
        })),
        ...this.#options,
      },
      {
        signal: controller.signal,
        onEvent: (event) => {
          this.#onEvent(event, () => {
            ready = true;
            Deferred.doneUnsafe(started, Exit.void);
          });
        },
      },
    );
    this.#request = request.then(
      () => undefined,
      (error: unknown) => {
        this.#onFailure(error, ready, started);
      },
    );
    return Deferred.await(started);
  }

  #sleep(delay: number): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      const cancel = unrefTimer(delay, () => {
        resume(Effect.void);
      });
      this.#wake = () => {
        cancel();
        resume(Effect.void);
      };
    });
  }

  #reconnect(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      let delay = RECONNECT_FIRST_MS;
      while (!this.#closed) {
        yield* this.#sleep(delay);
        this.#wake = undefined;
        if (this.#closed) return;
        const exit = yield* Effect.exit(this.#start());
        if (Exit.isSuccess(exit)) {
          this.#deliver({ overflow: true });
          return;
        }
        const error = Cause.squash(exit.cause);
        if (!isConnectionLost(error)) {
          this.#deliver({ error: toFileError(error, undefined) });
          this.#closed = true;
          return;
        }
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      }
    });
  }
}
