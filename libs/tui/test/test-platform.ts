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

import { pathOperations } from "../src/platform.ts";

export interface CommandRequest {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly input?: Uint8Array | undefined;
  readonly timeout?: number | undefined;
  readonly ignoreOutput?: boolean | undefined;
}

export interface CommandOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRequest {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined> | undefined;
}

export interface RunningProcess {
  readonly nextStdout: Effect.Effect<string>;
  readonly kill: (signal: "SIGKILL" | "SIGTERM") => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}

const testServices = Layer.mergeAll(
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- NodeFileSystem は unstable API で、安定した代替が無い
  NodeFileSystem.layer,
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- NodeCrypto は unstable API で、安定した代替が無い
  NodeCrypto.layer,
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- NodeChildProcessSpawner は unstable API で、安定した代替が無い
  NodeChildProcessSpawner.layer.pipe(
    // oxlint-disable-next-line effecttsgo/unstable-api-usage -- NodeFileSystem・NodePath は unstable API で、安定した代替が無い
    Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
  ),
);

const runtime = ManagedRuntime.make(testServices);

type TestServices = Layer.Success<typeof testServices>;

const run = <A, E>(effect: Effect.Effect<A, E, TestServices>): Effect.Effect<A> =>
  Effect.promise(() => runtime.runPromise(Effect.orDie(effect)));

// oxlint-disable-next-line effecttsgo/unstable-api-usage -- FileSystem は unstable API で、安定した代替が無い
const fileSystem = Effect.service(FileSystem.FileSystem);

export const makeTempDirectory = (prefix: string): Effect.Effect<string> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.makeTempDirectory({ prefix })));

export const removeRecursive = (path: string): Effect.Effect<void> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.remove(path, { recursive: true, force: true })));

export const makeDirectory = (path: string): Effect.Effect<void> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.makeDirectory(path, { recursive: true })));

export const writeFileString: {
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

export const readFileString = (path: string): Effect.Effect<string> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.readFileString(path)));

export const readFileBytes = (path: string): Effect.Effect<Uint8Array> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.readFile(path)));

export const symlink: {
  (target: string, path: string): Effect.Effect<void>;
  (path: string): (target: string) => Effect.Effect<void>;
} = dual(2, (target: string, path: string): Effect.Effect<void> =>
  run(Effect.flatMap(fileSystem, (fs) => fs.symlink(target, path))),
);

export const sha256Hex = (bytes: Uint8Array): Effect.Effect<string> =>
  run(
    Effect.flatMap(
      // oxlint-disable-next-line effecttsgo/unstable-api-usage -- Crypto は unstable API で、安定した代替が無い
      Effect.service(Crypto.Crypto),
      (crypto) => crypto.digest("SHA-256", bytes),
    ).pipe(Effect.map(Hex.encode)),
  );

const makeCommand = (request: {
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly input?: Uint8Array | undefined;
  readonly killSignal?: "SIGKILL" | "SIGTERM" | undefined;
  readonly ignoreOutput?: boolean | undefined;
}) =>
  // oxlint-disable-next-line effecttsgo/unstable-api-usage -- ChildProcess は unstable API で、安定した代替が無い
  ChildProcess.make(request.file, [...request.args], {
    detached: false,
    env: request.env,
    killSignal: request.killSignal ?? "SIGTERM",
    stdin: request.input === undefined ? "ignore" : Stream.make(request.input),
    stdout: request.ignoreOutput === true ? "ignore" : "pipe",
    stderr: request.ignoreOutput === true ? "ignore" : "pipe",
  });

// oxlint-disable-next-line effecttsgo/unstable-api-usage -- ChildProcessSpawner は unstable API で、安定した代替が無い
const spawner = Effect.service(ChildProcessSpawner.ChildProcessSpawner);

const collectCommand = (request: CommandRequest) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* Effect.flatMap(spawner, (service) =>
        service.spawn(makeCommand(request)),
      );
      if (request.ignoreOutput === true) {
        return { exitCode: yield* handle.exitCode, stdout: "", stderr: "" };
      }
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: 3 },
      );
      return { exitCode, stdout, stderr };
    }),
  );

export const runCommand = (request: CommandRequest): Effect.Effect<CommandOutput> =>
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

export const runCommandChecked = (request: CommandRequest): Effect.Effect<CommandOutput> =>
  runCommand(request).pipe(
    Effect.filterOrElse(
      (output) => output.exitCode === 0,
      (output) => Effect.die(`${request.file} exited with ${output.exitCode}: ${output.stderr}`),
    ),
  );

const spawnInScope = (request: ProcessRequest, scope: Scope.Closeable) =>
  Effect.gen(function* () {
    const service = yield* spawner;
    const handle = yield* Scope.provide(
      service.spawn(
        makeCommand({
          file: request.command,
          args: request.args,
          env: request.env,
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
      nextStdout: run(Effect.raceFirst(Queue.take(chunks), exited)),
      kill: (signal: "SIGKILL" | "SIGTERM") =>
        run(handle.kill({ killSignal: signal }).pipe(Effect.ignore)),
      close: Scope.close(scope, Exit.void),
    };
  });

export const startProcess = (request: ProcessRequest): Effect.Effect<RunningProcess> =>
  run(Effect.flatMap(Scope.make(), (scope) => spawnInScope(request, scope)));
