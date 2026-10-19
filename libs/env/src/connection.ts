import { Clock, Deferred, Effect, Exit } from "effect";

import { type Launched, launchDaemon } from "./daemon-process.ts";
import {
  CANCEL,
  ERROR,
  EVENT,
  frame,
  MAX_FRAME,
  parseFrameJson,
  PING,
  REQUEST,
  RESULT,
} from "./frame.ts";
import { closed, errorMessage, type Json, lost, RemoteError, type Wire } from "./remote-error.ts";
import type { ConnectionOptions, RemoteInfo, RequestOptions } from "./remote-info.ts";
import type { Reply, Session } from "./session.ts";

export { isConnectionLost, type Json, RemoteError } from "./remote-error.ts";
export type { Reply } from "./session.ts";

const SILENCE_LIMIT_MS = 30_000;
const START_TIMEOUT_MS = 60_000;
const SYNC_NOISE_LIMIT = 1024 * 1024;

type Started = { info: RemoteInfo; session: Session };

const currentTime = (): number => Effect.runSync(Clock.currentTimeMillis);

export class Connection {
  readonly #options: ConnectionOptions;
  #session: Session | undefined;
  #ready: Promise<Started> | undefined;
  #sessions = 0;
  #nextId = 1;
  #closed = false;

  constructor(options: ConnectionOptions) {
    this.#options = options;
  }

  info(): Promise<RemoteInfo> {
    return this.#connect().then((ready) => ready.info);
  }

  session(): Promise<number> {
    return this.#connect().then((ready) => ready.session.id);
  }

  request(op: string, json: Json, options: RequestOptions = {}): Promise<Reply> {
    if (options.session !== undefined) {
      const current = this.#session;
      if (current === undefined || current.id !== options.session || !current.live) {
        return Promise.reject(lost("msa-env connection lost"));
      }
      return this.#send(current, op, json, options);
    }
    return this.#connect().then(({ session }) => this.#send(session, op, json, options));
  }

  close(): void {
    this.#closed = true;
    if (this.#session !== undefined) this.#teardown(this.#session, closed());
  }

  kill(id: number, session: number): void {
    const current = this.#session;
    if (current?.id === session && current.live) {
      this.#write(current, frame({ type: CANCEL, id, json: { mode: "kill" } }));
    }
  }

  #connect(): Promise<Started> {
    if (this.#closed) return Promise.reject(closed());
    if (this.#ready === undefined) {
      const ready = Effect.runPromise(this.#start());
      this.#ready = ready;
      ready.catch(() => {
        if (this.#ready === ready) this.#ready = undefined;
      });
    }
    return this.#ready;
  }

  #send(session: Session, op: string, json: Json, options: RequestOptions): Promise<Reply> {
    return Effect.runPromise(this.#exchange(session, op, json, options));
  }

  #exchange(
    session: Session,
    op: string,
    json: Json,
    options: RequestOptions,
  ): Effect.Effect<Reply, Error> {
    if (!session.live) return Effect.fail(lost("msa-env connection lost"));
    const id = this.#nextId++;
    const reply = Deferred.makeUnsafe<Reply, Error>();
    const onAbort = (): void => {
      this.#write(session, frame({ type: CANCEL, id, json: {} }));
    };
    const done = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    session.pending.set(id, {
      resolve: (value) => {
        done();
        Deferred.doneUnsafe(reply, Exit.succeed(value));
      },
      reject: (error) => {
        done();
        Deferred.doneUnsafe(reply, Exit.fail(error));
      },
      ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    options.onStart?.(id, session.id);
    this.#write(
      session,
      frame({ type: REQUEST, id, json: { ...json, op }, payload: options.payload }),
    );
    if (options.signal?.aborted === true) onAbort();
    return Deferred.await(reply);
  }

  #write(session: Session, data: Buffer): void {
    if (session.live) session.write(data);
  }

  #start(): Effect.Effect<Started, Error> {
    return Effect.gen({ self: this }, function* () {
      const command = yield* this.#command();
      if (this.#closed) return yield* closed();
      const [program, ...args] = command;
      if (program === undefined) {
        return yield* new RemoteError({ code: "spawn_error", message: "No daemon command" });
      }
      const startedAt = yield* Clock.currentTimeMillis;
      return yield* this.#hello(yield* this.#launch(program, args, startedAt));
    });
  }

  #command(): Effect.Effect<readonly string[], RemoteError> {
    const option = this.#options.command;
    if (typeof option !== "function") return Effect.succeed(option);
    return Effect.tryPromise({
      try: () => option(),
      catch: (error) =>
        new RemoteError({ code: "spawn_error", message: errorMessage(error), lost: true }),
    });
  }

  #launch(
    program: string,
    args: readonly string[],
    startedAt: number,
  ): Effect.Effect<Launched, RemoteError> {
    return launchDaemon({
      program,
      args,
      id: ++this.#sessions,
      startedAt,
      onData: (session, chunk) => {
        this.#onData(session, chunk);
      },
      onLog: (text) => this.#options.onLog?.(text),
      onTick: (session) => {
        this.#tick(session);
      },
      onLost: (session) => {
        this.#teardown(session, lost("msa-env connection lost"));
      },
    }).pipe(
      Effect.tap(({ session }) =>
        Effect.sync(() => {
          this.#session = session;
        }),
      ),
    );
  }

  #hello({ session, failed }: Launched): Effect.Effect<Started, Error> {
    return this.#exchange(session, "hello", { protocol: 1 }, {}).pipe(
      Effect.raceFirst(Deferred.await(failed)),
      Effect.timeoutOrElse({
        duration: START_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(lost(`msa-env did not answer within ${START_TIMEOUT_MS / 1000} s`)),
      }),
      Effect.flatMap(({ json }) =>
        json["protocol"] === 1
          ? Effect.succeed({ info: json as Wire<RemoteInfo>, session })
          : Effect.fail(lost(`Unsupported protocol ${String(json["protocol"])}`)),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          this.#teardown(session, error);
        }),
      ),
    );
  }

  #tick(session: Session): void {
    this.#write(session, frame({ type: PING, id: 0, json: {} }));
    if (currentTime() - session.lastSeen > SILENCE_LIMIT_MS) {
      this.#teardown(session, lost("msa-env connection timed out"));
    }
  }

  #teardown(session: Session, error: Error): void {
    if (!session.live) return;
    session.live = false;
    if (this.#session === session) {
      this.#session = undefined;
      this.#ready = undefined;
    }
    session.end();
    const pending = [...session.pending.values()];
    session.pending.clear();
    for (const request of pending) request.reject(error);
  }

  #onData(session: Session, chunk: Buffer): void {
    if (!session.live) return;
    session.lastSeen = currentTime();
    session.chunks.push(chunk);
    session.buffered += chunk.length;
    if (!session.synced && !this.#sync(session)) return;
    this.#readFrames(session);
  }

  #sync(session: Session): boolean {
    const marker = Buffer.from(`MSA-ENV ${session.token}\n`, "utf8");
    const all = session.peek(session.buffered);
    const index = all.indexOf(marker);
    if (index === -1) {
      if (session.buffered > SYNC_NOISE_LIMIT) {
        session.consume(session.buffered - marker.length);
      }
      return false;
    }
    const noise = all.subarray(0, index).toString("utf8").trim();
    if (noise !== "") this.#options.onLog?.(noise);
    session.consume(index + marker.length);
    session.synced = true;
    return true;
  }

  #readFrames(session: Session): void {
    while (session.live && session.buffered >= 4) {
      const length = session.peek(4).readUInt32BE(0);
      if (length < 9 || length > MAX_FRAME) {
        this.#teardown(session, lost("Corrupt frame from msa-env"));
        return;
      }
      if (session.buffered < 4 + length) return;
      const body = session.peek(4 + length).subarray(4);
      const type = body.readUInt8(0);
      const id = body.readUInt32BE(1);
      const jsonLength = body.readUInt32BE(5);
      const json = parseFrameJson(body, length, jsonLength);
      if (json === undefined) {
        this.#teardown(session, lost("Corrupt frame from msa-env"));
        return;
      }
      const payload = new Uint8Array(body.subarray(9 + jsonLength));
      session.consume(4 + length);
      this.#dispatch(session, type, id, json, payload);
    }
  }

  #dispatch(session: Session, type: number, id: number, json: Json, payload: Uint8Array): void {
    const pending = session.pending.get(id);
    if (type === EVENT) {
      pending?.onEvent?.(json, payload);
      return;
    }
    if (type !== RESULT && type !== ERROR) return;
    if (pending === undefined) return;
    session.pending.delete(id);
    if (type === RESULT) pending.resolve({ json, payload, session: session.id });
    else pending.reject(new RemoteError(json));
  }
}
