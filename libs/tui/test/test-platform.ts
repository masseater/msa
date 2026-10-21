import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import {
  Crypto,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  ManagedRuntime,
  Queue,
  Scope,
  Stream,
} from "effect";
import { Hex } from "effect/encoding";
import { dual } from "effect/Function";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import platform from "../src/platform.ts";
import type testPlatformTypes from "./test-platform.types.ts";

const { pathOperations } = platform;

const testServices = Layer.mergeAll(
  NodeFileSystem.layer,
  NodeCrypto.layer,
  NodeChildProcessSpawner.layer.pipe(
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  ),
);

const runtime = ManagedRuntime.make(testServices);

type TestServices = Layer.Success<typeof testServices>;

const run = <A, E>(effect: Effect.Effect<A, E, TestServices>): Effect.Effect<A> =>
  Effect.promise(() => runtime.runPromise(Effect.orDie(effect)));

const fileSystem = Effect.service(FileSystem.FileSystem);

const makeTempDirectory = (prefix: string): Effect.Effect<string> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.makeTempDirectory({ prefix })));

const removeRecursive = (path: string): Effect.Effect<void> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.remove(path, { force: true, recursive: true })));

const makeDirectory = (path: string): Effect.Effect<void> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.makeDirectory(path, { recursive: true })));

const writeFileString: {
  (path: string, contents: string): Effect.Effect<void>;
  (contents: string): (path: string) => Effect.Effect<void>;
} = dual(2, (path: string, contents: string): Effect.Effect<void> =>
  run(
    Effect.flatMap(fileSystem, (fs) =>
      Effect.andThen(
        fs.makeDirectory(pathOperations.dirname(path), { recursive: true }),
        fs.writeFileString(path, contents),
      ),
    ),
  ),
);

const readFileString = (path: string): Effect.Effect<string> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.readFileString(path)));

const readFileBytes = (path: string): Effect.Effect<Uint8Array> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.readFile(path)));

const symlink: {
  (target: string, path: string): Effect.Effect<void>;
  (path: string): (target: string) => Effect.Effect<void>;
} = dual(2, (target: string, path: string): Effect.Effect<void> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.symlink(target, path))),
);

const sha256Hex = (bytes: Uint8Array): Effect.Effect<string> =>
  run(
    Effect.flatMap(Effect.service(Crypto.Crypto), (crypto) => crypto.digest("SHA-256", bytes)).pipe(
      Effect.map(Hex.encode),
    ),
  );

const makeCommand = (request: {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly input?: Uint8Array | undefined;
  readonly killSignal?: "SIGKILL" | "SIGTERM" | undefined;
  readonly ignoreOutput?: boolean | undefined;
}) =>
  ChildProcess.make(request.file, [...request.args], {
    detached: false,
    env: request.env,
    killSignal: request.killSignal ?? "SIGTERM",
    stderr: request.ignoreOutput === true ? "ignore" : "pipe",
    stdin: request.input === undefined ? "ignore" : Stream.make(request.input),
    stdout: request.ignoreOutput === true ? "ignore" : "pipe",
  });

const spawner = Effect.service(ChildProcessSpawner.ChildProcessSpawner);

const collectCommand = (request: testPlatformTypes.CommandRequest) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* Effect.flatMap(spawner, (service) =>
        service.spawn(makeCommand(request)),
      );
      if (request.ignoreOutput === true) {
        return { exitCode: yield* handle.exitCode, stderr: "", stdout: "" };
      }
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );
      return { exitCode, stderr, stdout };
    }),
  );

const runCommand = (
  request: testPlatformTypes.CommandRequest,
): Effect.Effect<testPlatformTypes.CommandOutput> =>
  run(
    request.timeout === undefined
      ? collectCommand(request)
      : collectCommand(request).pipe(
          Effect.timeoutOrElse({
            duration: request.timeout,
            orElse: () => Effect.die(`${request.file} timed out after ${request.timeout}ms`),
          }),
        ),
  );

const runCommandChecked = (
  request: testPlatformTypes.CommandRequest,
): Effect.Effect<testPlatformTypes.CommandOutput> =>
  runCommand(request).pipe(
    Effect.filterOrElse(
      (output) => output.exitCode === 0,
      (output) => Effect.die(`${request.file} exited with ${output.exitCode}: ${output.stderr}`),
    ),
  );

const spawnInScope = (request: testPlatformTypes.ProcessRequest, scope: Scope.Closeable) =>
  Effect.gen(function* () {
    const service = yield* spawner;
    const handle = yield* Scope.provide(
      service.spawn(
        makeCommand({
          args: request.args,
          env: request.env,
          file: request.command,
          killSignal: "SIGKILL",
        }),
      ),
      scope,
    );
    const chunks = yield* Queue.unbounded<string>();
    yield* Effect.forkIn(
      Stream.runForEach(Stream.decodeText(handle.stdout), (chunk) => Queue.offer(chunks, chunk)),
      scope,
    );
    const stderr = yield* Effect.forkIn(Stream.mkString(Stream.decodeText(handle.stderr)), scope);
    const exited = handle.exitCode.pipe(
      Effect.flatMap((code) =>
        Effect.flatMap(Fiber.join(stderr), (output) =>
          Effect.die(`${request.command} exited with ${code}: ${output}`),
        ),
      ),
    );
    return {
      close: Scope.close(scope, Exit.void),
      kill: (signal: "SIGKILL" | "SIGTERM") =>
        run(handle.kill({ killSignal: signal }).pipe(Effect.ignore)),
      nextStdout: run(Effect.raceFirst(Queue.take(chunks), exited)),
    };
  });

const startProcess = (
  request: testPlatformTypes.ProcessRequest,
): Effect.Effect<testPlatformTypes.RunningProcess> =>
  run(Effect.flatMap(Scope.make(), (scope) => spawnInScope(request, scope)));

const testPlatform = {
  makeDirectory,
  makeTempDirectory,
  readFileBytes,
  readFileString,
  removeRecursive,
  runCommand,
  runCommandChecked,
  sha256Hex,
  startProcess,
  symlink,
  writeFileString,
};

export default testPlatform;
