import { type Cause, Deferred, Effect, Exit, Queue, Scope, Stream } from "effect";

import { randomHex, spawnProcess } from "./platform.ts";
import { lost, RemoteError } from "./remote-error.ts";
import { Session } from "./session.ts";

const PING_INTERVAL_MS = 5000;

export type Launched = { session: Session; failed: Deferred.Deferred<never, RemoteError> };

export interface DaemonLaunch {
  readonly program: string;
  readonly args: readonly string[];
  readonly id: number;
  readonly startedAt: number;
  readonly onData: (session: Session, chunk: Buffer) => void;
  readonly onLog: (text: string) => void;
  readonly onTick: (session: Session) => void;
  readonly onLost: (session: Session) => void;
}

const asBuffer = (chunk: Uint8Array): Buffer =>
  Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);

const sessionTasks = (
  launch: DaemonLaunch,
  session: Session,
  failed: Deferred.Deferred<never, RemoteError>,
  process: {
    stdout: Stream.Stream<Uint8Array>;
    stderr: Stream.Stream<Uint8Array>;
    exitCode: Effect.Effect<number | null>;
  },
): readonly Effect.Effect<void>[] => [
  Stream.runForEach(process.stdout, (chunk) =>
    Effect.sync(() => {
      launch.onData(session, asBuffer(chunk));
    }),
  ),
  Stream.runForEach(process.stderr, (chunk) =>
    Effect.sync(() => {
      launch.onLog(asBuffer(chunk).toString("utf8"));
    }),
  ),
  Effect.flatMap(process.exitCode, (code) =>
    Effect.sync(() => {
      Deferred.doneUnsafe(
        failed,
        Exit.fail(lost(`msa-env exited with code ${code} before it was ready`)),
      );
      launch.onLost(session);
    }),
  ),
  Effect.sync(() => {
    launch.onTick(session);
  }).pipe(Effect.delay(PING_INTERVAL_MS), Effect.forever),
];

export const launchDaemon = (launch: DaemonLaunch): Effect.Effect<Launched, RemoteError> =>
  Effect.gen(function* () {
    const token = yield* randomHex(16);
    const input = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    const scope = yield* Scope.make();
    const process = yield* spawnProcess({
      command: launch.program,
      args: [...launch.args, "serve", "--token", token],
      stdin: Stream.fromQueue(input),
    }).pipe(
      Scope.provide(scope),
      Effect.mapError(
        (error) => new RemoteError({ code: "spawn_error", message: error.message, lost: true }),
      ),
      Effect.tapError(() => Scope.close(scope, Exit.void)),
    );
    const session = new Session({ id: launch.id, input, scope, token, now: launch.startedAt });
    const failed = Deferred.makeUnsafe<never, RemoteError>();
    for (const task of sessionTasks(launch, session, failed, process)) {
      yield* Effect.forkIn(task, scope);
    }
    return { session, failed };
  });
