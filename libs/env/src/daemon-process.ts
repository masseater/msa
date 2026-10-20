import { type Cause, Deferred, Effect, Exit, Queue, Scope, Stream } from "effect";

import type daemonProcessTypes from "./daemon-process.types.ts";
import platform from "./platform.ts";
import remoteError from "./remote-error.ts";
import type remoteErrorTypes from "./remote-error.types.ts";
import Session from "./session.ts";
import type sessionTypes from "./session.types.ts";

const { RemoteError, lost } = remoteError;
const { randomHex, spawnProcess } = platform;

const PING_INTERVAL_MS = 5000;

const asBuffer = (chunk: Uint8Array): Buffer =>
  Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);

const sessionTasks = (
  launch: daemonProcessTypes.DaemonLaunch,
  session: sessionTypes.Session,
  failed: Deferred.Deferred<never, remoteErrorTypes.RemoteError>,
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

const launchDaemon = (
  launch: daemonProcessTypes.DaemonLaunch,
): Effect.Effect<daemonProcessTypes.Launched, remoteErrorTypes.RemoteError> =>
  Effect.gen(function* () {
    const token = yield* randomHex(16);
    const input = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    const scope = yield* Scope.make();
    const process = yield* spawnProcess({
      args: [...launch.args, "serve", "--token", token],
      command: launch.program,
      stdin: Stream.fromQueue(input),
    }).pipe(
      Scope.provide(scope),
      Effect.mapError(
        (error) => new RemoteError({ code: "spawn_error", lost: true, message: error.message }),
      ),
      Effect.tapError(() => Scope.close(scope, Exit.void)),
    );
    const session = new Session({ id: launch.id, input, now: launch.startedAt, scope, token });
    const failed = Deferred.makeUnsafe<never, remoteErrorTypes.RemoteError>();
    for (const task of sessionTasks(launch, session, failed, process)) {
      yield* Effect.forkIn(task, scope);
    }
    return { failed, session };
  });

const daemonProcess = {
  launchDaemon,
};

export default daemonProcess;
