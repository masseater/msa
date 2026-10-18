import { tmpdir } from "node:os";

import { Effect, FileSystem, Path, type PlatformError, Predicate, Schedule, Stream } from "effect";
import { dual } from "effect/Function";
import { ChildProcess } from "effect/process";

import { nodeRuntime } from "../src/node-runtime.ts";

const fileSystem = nodeRuntime.runSync(FileSystem.FileSystem);
const paths = nodeRuntime.runSync(Path.Path);

export const joinPath = (...parts: readonly string[]): string => paths.join(...parts);

export const dirnameOf = (path: string): string => paths.dirname(path);

export const basenameOf = (path: string): string => paths.basename(path);

export const resolvePath = (...parts: readonly string[]): string => paths.resolve(...parts);

export const pathDelimiter = process.platform === "win32" ? ";" : ":";

export const tempPath = (name: string): string => joinPath(tmpdir(), name);

export const makeTempDir = (prefix: string): Effect.Effect<string> =>
  Effect.orDie(fileSystem.makeTempDirectory({ prefix }));

export interface TempFile {
  readonly directory: string;
  readonly path: string;
}

export const makeTempFile = Effect.fn("makeTempFile")(function* (prefix: string, name: string) {
  const directory = yield* makeTempDir(prefix);
  return { directory, path: joinPath(directory, name) } satisfies TempFile;
});

export const removeDir = (directory: string): Effect.Effect<void> =>
  Effect.orDie(fileSystem.remove(directory, { recursive: true, force: true }));

const retriable = (error: PlatformError.PlatformError): boolean =>
  Predicate.isTagged(error.reason, "Busy") ||
  Predicate.isTagged(error.reason, "PermissionDenied") ||
  Predicate.isTagged(error.reason, "Unknown");

export const removeDirRetrying = (directory: string): Effect.Effect<void> =>
  fileSystem
    .remove(directory, { recursive: true, force: true })
    .pipe(
      Effect.retry({ times: 80, schedule: Schedule.spaced(100), while: retriable }),
      Effect.orDie,
    );

export const removeDirs = (directories: Iterable<string>) =>
  Effect.forEach(directories, removeDir, { discard: true });

export const writeTempFile = Effect.fn("writeTempFile")(function* (
  directory: string,
  name: string,
  content: string | Uint8Array,
) {
  const path = joinPath(directory, name);
  yield* Effect.orDie(
    typeof content === "string"
      ? fileSystem.writeFileString(path, content)
      : fileSystem.writeFile(path, content),
  );
});

export const readTempFile = Effect.fn("readTempFile")(function* (directory: string, name: string) {
  return yield* Effect.orDie(fileSystem.readFileString(joinPath(directory, name)));
});

export const appendTempFile = Effect.fn("appendTempFile")(function* (
  directory: string,
  name: string,
  content: string,
) {
  yield* Effect.orDie(
    fileSystem.writeFileString(joinPath(directory, name), content, { flag: "a" }),
  );
});

export const readText = (path: string): Effect.Effect<string> =>
  Effect.orDie(fileSystem.readFileString(path));

export const readBytes = (path: string): Effect.Effect<Uint8Array> =>
  Effect.orDie(fileSystem.readFile(path));

export const writeText = Effect.fn("writeText")(function* (path: string, content: string) {
  yield* Effect.orDie(fileSystem.writeFileString(path, content));
});

export const writeBytes = Effect.fn("writeBytes")(function* (path: string, content: Uint8Array) {
  yield* Effect.orDie(fileSystem.writeFile(path, content));
});

export const appendBytes = Effect.fn("appendBytes")(function* (path: string, content: Uint8Array) {
  yield* Effect.orDie(fileSystem.writeFile(path, content, { flag: "a" }));
});

export const appendText = Effect.fn("appendText")(function* (path: string, content: string) {
  yield* Effect.orDie(fileSystem.writeFileString(path, content, { flag: "a" }));
});

export const fileSize = (path: string): Effect.Effect<number> =>
  Effect.orDie(fileSystem.stat(path)).pipe(Effect.map((info) => Number(info.size)));

export const isDirectory = (path: string): Effect.Effect<boolean> =>
  Effect.orDie(fileSystem.stat(path)).pipe(Effect.map((info) => info.type === "Directory"));

export const isFile = (path: string): Effect.Effect<boolean> =>
  Effect.orDie(fileSystem.stat(path)).pipe(Effect.map((info) => info.type === "File"));

export const listDirectory = (path: string): Effect.Effect<string[]> =>
  Effect.orDie(fileSystem.readDirectory(path));

export const listTree = (path: string): Effect.Effect<string[]> =>
  Effect.orDie(fileSystem.readDirectory(path, { recursive: true }));

export const pathExists = (path: string): Effect.Effect<boolean> =>
  Effect.orDie(fileSystem.exists(path));

export const makeDirectory = (path: string): Effect.Effect<void> =>
  Effect.orDie(fileSystem.makeDirectory(path, { recursive: true }));

export const changeMode = Effect.fn("changeMode")(function* (path: string, mode: number) {
  yield* Effect.orDie(fileSystem.chmod(path, mode));
});

export const restoreWritable = (path: string): Effect.Effect<void> =>
  Effect.ignore(fileSystem.chmod(path, 0o700));

export const realPath = (path: string): Effect.Effect<string> =>
  Effect.orDie(fileSystem.realPath(path));

export const makeSymlink = Effect.fn("makeSymlink")(function* (target: string, path: string) {
  yield* Effect.orDie(fileSystem.symlink(target, path));
});

export const copyPath = Effect.fn("copyPath")(function* (from: string, to: string) {
  yield* Effect.orDie(fileSystem.copy(from, to));
});

export const copyFile = Effect.fn("copyFile")(function* (from: string, to: string) {
  yield* Effect.orDie(fileSystem.copyFile(from, to));
});

export const withTempDir: {
  <A, E>(use: (directory: string) => Effect.Effect<A, E>): (prefix: string) => Effect.Effect<A, E>;
  <A, E>(prefix: string, use: (directory: string) => Effect.Effect<A, E>): Effect.Effect<A, E>;
} = dual(
  2,
  <A, E>(prefix: string, use: (directory: string) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.acquireUseRelease(makeTempDir(prefix), use, removeDir),
);

export interface CommandResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
}

const collect = (command: string, args: readonly string[], options: CommandOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, options);
      const [stdout, stderr, status] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(child.stdout)),
          Stream.mkString(Stream.decodeText(child.stderr)),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );
      const result: CommandResult = { status: Number(status), stdout, stderr };
      return result;
    }),
  );

export const runCommand = Effect.fn("runCommand")(function* (
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
) {
  const context = yield* nodeRuntime.contextEffect;
  return yield* collect(command, args, options).pipe(Effect.provideContext(context), Effect.orDie);
});

export const runCommandOrFail = Effect.fn("runCommandOrFail")(function* (
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
) {
  const result = yield* runCommand(command, args, options);
  if (result.status !== 0)
    throw new Error(`${command} exited with ${result.status}: ${result.stderr}`);
  return result.stdout;
});

export const writeChunks = Effect.fn("writeChunks")(function* (
  path: string,
  chunks: Iterable<Uint8Array>,
) {
  yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* fileSystem.open(path, { flag: "w" });
      for (const chunk of chunks) yield* file.writeAll(chunk);
    }),
  ).pipe(Effect.orDie);
});
