import { Clock, Deferred, Effect, Exit } from "effect";

import daemonProcess from "./daemon-process.ts";
import type daemonProcessTypes from "./daemon-process.types.ts";
import frameModule from "./frame.ts";
import remoteError from "./remote-error.ts";
import type remoteErrorTypes from "./remote-error.types.ts";
import type remoteInfoTypes from "./remote-info.types.ts";
import sessionSync from "./session-sync.ts";
import type sessionTypes from "./session.types.ts";

const { RemoteError, closed, errorMessage, lost } = remoteError;
const { CANCEL, ERROR, EVENT, MAX_FRAME, PING, REQUEST, RESULT, frame, parseFrameJson } =
  frameModule;
const { launchDaemon } = daemonProcess;
const { syncSession } = sessionSync;

const SILENCE_LIMIT_MS = 30_000;

const START_TIMEOUT_MS = 60_000;

type Started = { info: remoteInfoTypes.RemoteInfo; session: sessionTypes.Session };

const currentTime = (): number => Effect.runSync(Clock.currentTimeMillis);

export default class Connection {
  readonly #options: remoteInfoTypes.ConnectionOptions;
  #session: sessionTypes.Session | undefined;
  #ready: Promise<Started> | undefined;
  #sessions = 0;
  #nextId = 1;
  #closed = false;

  constructor(options: remoteInfoTypes.ConnectionOptions) {
    this.#options = options;
  }

  info(): Promise<remoteInfoTypes.RemoteInfo> {
    return this.#connect().then((ready) => ready.info);
  }

  session(): Promise<number> {
    return this.#connect().then((ready) => ready.session.id);
  }

  request(
    op: string,
    json: remoteErrorTypes.Json,
    options: remoteInfoTypes.RequestOptions = {},
  ): Promise<sessionTypes.Reply> {
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
      this.#write(current, frame({ id, json: { mode: "kill" }, type: CANCEL }));
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

  #send(
    session: sessionTypes.Session,
    op: string,
    json: remoteErrorTypes.Json,
    options: remoteInfoTypes.RequestOptions,
  ): Promise<sessionTypes.Reply> {
    return Effect.runPromise(this.#exchange(session, op, json, options));
  }

  #exchange(
    session: sessionTypes.Session,
    op: string,
    json: remoteErrorTypes.Json,
    options: remoteInfoTypes.RequestOptions,
  ): Effect.Effect<sessionTypes.Reply, Error> {
    if (!session.live) return Effect.fail(lost("msa-env connection lost"));
    const id = this.#nextId++;
    const reply = Deferred.makeUnsafe<sessionTypes.Reply, Error>();
    const onAbort = (): void => {
      this.#write(session, frame({ id, json: {}, type: CANCEL }));
    };
    const done = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    session.pending.set(id, {
      reject: (error) => {
        done();
        Deferred.doneUnsafe(reply, Exit.fail(error));
      },
      resolve: (value) => {
        done();
        Deferred.doneUnsafe(reply, Exit.succeed(value));
      },
      ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    options.onStart?.(id, session.id);
    this.#write(
      session,
      frame({ id, json: { ...json, op }, payload: options.payload, type: REQUEST }),
    );
    if (options.signal?.aborted === true) onAbort();
    return Deferred.await(reply);
  }

  #write(session: sessionTypes.Session, data: Buffer): void {
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

  #command(): Effect.Effect<readonly string[], remoteErrorTypes.RemoteError> {
    const option = this.#options.command;
    if (typeof option !== "function") return Effect.succeed(option);
    return Effect.tryPromise({
      catch: (error) =>
        new RemoteError({ code: "spawn_error", lost: true, message: errorMessage(error) }),
      try: () => option(),
    });
  }

  #launch(
    program: string,
    args: readonly string[],
    startedAt: number,
  ): Effect.Effect<daemonProcessTypes.Launched, remoteErrorTypes.RemoteError> {
    return launchDaemon({
      args,
      id: ++this.#sessions,
      onData: (session, chunk) => {
        this.#onData(session, chunk);
      },
      onLog: (text) => this.#options.onLog?.(text),
      onLost: (session) => {
        this.#teardown(session, lost("msa-env connection lost"));
      },
      onTick: (session) => {
        this.#tick(session);
      },
      program,
      startedAt,
    }).pipe(
      Effect.tap(({ session }) =>
        Effect.sync(() => {
          this.#session = session;
        }),
      ),
    );
  }

  #hello({ session, failed }: daemonProcessTypes.Launched): Effect.Effect<Started, Error> {
    return this.#exchange(session, "hello", { protocol: 1 }, {}).pipe(
      Effect.raceFirst(Deferred.await(failed)),
      Effect.timeoutOrElse({
        duration: START_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(lost(`msa-env did not answer within ${START_TIMEOUT_MS / 1000} s`)),
      }),
      Effect.flatMap(({ json }) =>
        json["protocol"] === 1
          ? Effect.succeed({
              info: json as remoteErrorTypes.Wire<remoteInfoTypes.RemoteInfo>,
              session,
            })
          : Effect.fail(lost(`Unsupported protocol ${String(json["protocol"])}`)),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          this.#teardown(session, error);
        }),
      ),
    );
  }

  #tick(session: sessionTypes.Session): void {
    this.#write(session, frame({ id: 0, json: {}, type: PING }));
    if (currentTime() - session.lastSeen > SILENCE_LIMIT_MS) {
      this.#teardown(session, lost("msa-env connection timed out"));
    }
  }

  #teardown(session: sessionTypes.Session, error: Error): void {
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

  #onData(session: sessionTypes.Session, chunk: Buffer): void {
    if (!session.live) return;
    session.lastSeen = currentTime();
    session.chunks.push(chunk);
    session.buffered += chunk.length;
    if (!session.synced && !syncSession(session, (text) => this.#options.onLog?.(text))) return;
    this.#readFrames(session);
  }

  #readFrames(session: sessionTypes.Session): void {
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

  #dispatch(
    session: sessionTypes.Session,
    type: number,
    id: number,
    json: remoteErrorTypes.Json,
    payload: Uint8Array,
  ): void {
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
