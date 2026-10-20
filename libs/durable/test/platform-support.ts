import { tmpdir } from "node:os";

import { Effect, FileSystem, Path, type PlatformError, Predicate, Schedule, Stream } from "effect";
import { dual } from "effect/Function";
import { ChildProcess } from "effect/process";

import { environmentVariable as environmentVariableModule } from "../src/env/node-process.ts";
import { nodeRuntime } from "../src/node-runtime.ts";
import type platformSupportTypes from "./platform-support.types.ts";

const fileSystem = nodeRuntime.runSync(FileSystem.FileSystem);
const paths = nodeRuntime.runSync(Path.Path);

const joinPath = (...parts: readonly string[]): string => paths.join(...parts);

const dirnameOf = (path: string): string => paths.dirname(path);

const basenameOf = (path: string): string => paths.basename(path);

const resolvePath = (...parts: readonly string[]): string => paths.resolve(...parts);

const pathDelimiter = process.platform === "win32" ? ";" : ":";

const tempPath = (name: string): string => joinPath(tmpdir(), name);

const makeTempDir = (prefix: string): Effect.Effect<string> =>
  Effect.orDie(fileSystem.makeTempDirectory({ prefix }));

const makeTempFile = Effect.fn("makeTempFile")(function* (prefix: string, name: string) {
  const directory = yield* makeTempDir(prefix);
  return { directory, path: joinPath(directory, name) } satisfies platformSupportTypes.TempFile;
});

const removeDir = (directory: string): Effect.Effect<void> =>
  Effect.orDie(fileSystem.remove(directory, { force: true, recursive: true }));

const retriable = (error: PlatformError.PlatformError): boolean =>
  Predicate.isTagged(error.reason, "Busy") ||
  Predicate.isTagged(error.reason, "PermissionDenied") ||
  Predicate.isTagged(error.reason, "Unknown");

const removeDirRetrying = (directory: string): Effect.Effect<void> =>
  fileSystem
    .remove(directory, { force: true, recursive: true })
    .pipe(
      Effect.retry({ schedule: Schedule.spaced(100), times: 80, while: retriable }),
      Effect.orDie,
    );

const removeDirs = (directories: Iterable<string>) =>
  Effect.forEach(directories, removeDir, { discard: true });

const writeTempFile = Effect.fn("writeTempFile")(function* (
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

const readTempFile = Effect.fn("readTempFile")(function* (directory: string, name: string) {
  return yield* Effect.orDie(fileSystem.readFileString(joinPath(directory, name)));
});

const appendTempFile = Effect.fn("appendTempFile")(function* (
  directory: string,
  name: string,
  content: string,
) {
  yield* Effect.orDie(
    fileSystem.writeFileString(joinPath(directory, name), content, { flag: "a" }),
  );
});

const readText = (path: string): Effect.Effect<string> =>
  Effect.orDie(fileSystem.readFileString(path));

const readBytes = (path: string): Effect.Effect<Uint8Array> =>
  Effect.orDie(fileSystem.readFile(path));

const writeText = Effect.fn("writeText")(function* (path: string, content: string) {
  yield* Effect.orDie(fileSystem.writeFileString(path, content));
});

const writeBytes = Effect.fn("writeBytes")(function* (path: string, content: Uint8Array) {
  yield* Effect.orDie(fileSystem.writeFile(path, content));
});

const appendBytes = Effect.fn("appendBytes")(function* (path: string, content: Uint8Array) {
  yield* Effect.orDie(fileSystem.writeFile(path, content, { flag: "a" }));
});

const appendText = Effect.fn("appendText")(function* (path: string, content: string) {
  yield* Effect.orDie(fileSystem.writeFileString(path, content, { flag: "a" }));
});

const fileSize = (path: string): Effect.Effect<number> =>
  Effect.orDie(fileSystem.stat(path)).pipe(Effect.map((info) => Number(info.size)));

const isDirectory = (path: string): Effect.Effect<boolean> =>
  Effect.orDie(fileSystem.stat(path)).pipe(Effect.map((info) => info.type === "Directory"));

const isFile = (path: string): Effect.Effect<boolean> =>
  Effect.orDie(fileSystem.stat(path)).pipe(Effect.map((info) => info.type === "File"));

const listDirectory = (path: string): Effect.Effect<string[]> =>
  Effect.orDie(fileSystem.readDirectory(path));

const listTree = (path: string): Effect.Effect<string[]> =>
  Effect.orDie(fileSystem.readDirectory(path, { recursive: true }));

const pathExists = (path: string): Effect.Effect<boolean> => Effect.orDie(fileSystem.exists(path));

const makeDirectory = (path: string): Effect.Effect<void> =>
  Effect.orDie(fileSystem.makeDirectory(path, { recursive: true }));

const changeMode = Effect.fn("changeMode")(function* (path: string, mode: number) {
  yield* Effect.orDie(fileSystem.chmod(path, mode));
});

const restoreWritable = (path: string): Effect.Effect<void> =>
  Effect.ignore(fileSystem.chmod(path, 0o700));

const realPath = (path: string): Effect.Effect<string> => Effect.orDie(fileSystem.realPath(path));

const makeSymlink = Effect.fn("makeSymlink")(function* (target: string, path: string) {
  yield* Effect.orDie(fileSystem.symlink(target, path));
});

const copyPath = Effect.fn("copyPath")(function* (from: string, to: string) {
  yield* Effect.orDie(fileSystem.copy(from, to));
});

const copyFile = Effect.fn("copyFile")(function* (from: string, to: string) {
  yield* Effect.orDie(fileSystem.copyFile(from, to));
});

const withTempDir: {
  <A, E>(use: (directory: string) => Effect.Effect<A, E>): (prefix: string) => Effect.Effect<A, E>;
  <A, E>(prefix: string, use: (directory: string) => Effect.Effect<A, E>): Effect.Effect<A, E>;
} = dual(
  2,
  <A, E>(prefix: string, use: (directory: string) => Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Effect.acquireUseRelease(makeTempDir(prefix), use, removeDir),
);

const collect = (
  command: string,
  args: readonly string[],
  options: platformSupportTypes.CommandOptions,
) =>
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
      const result: platformSupportTypes.CommandResult = { status: Number(status), stderr, stdout };
      return result;
    }),
  );

const runCommand = Effect.fn("runCommand")(function* (
  command: string,
  args: readonly string[],
  options: platformSupportTypes.CommandOptions = {},
) {
  const context = yield* nodeRuntime.contextEffect;
  return yield* collect(command, args, options).pipe(Effect.provideContext(context), Effect.orDie);
});

const runCommandOrFail = Effect.fn("runCommandOrFail")(function* (
  command: string,
  args: readonly string[],
  options: platformSupportTypes.CommandOptions = {},
) {
  const result = yield* runCommand(command, args, options);
  if (result.status !== 0)
    throw new Error(`${command} exited with ${result.status}: ${result.stderr}`);
  return result.stdout;
});

const writeChunks = Effect.fn("writeChunks")(function* (
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

const platformSupport = {
  appendBytes,
  appendTempFile,
  appendText,
  basenameOf,
  changeMode,
  copyFile,
  copyPath,
  dirnameOf,
  environmentVariable: environmentVariableModule,
  fileSize,
  isDirectory,
  isFile,
  joinPath,
  listDirectory,
  listTree,
  makeDirectory,
  makeSymlink,
  makeTempDir,
  makeTempFile,
  pathDelimiter,
  pathExists,
  readBytes,
  readTempFile,
  readText,
  realPath,
  removeDir,
  removeDirRetrying,
  removeDirs,
  resolvePath,
  restoreWritable,
  runCommand,
  runCommandOrFail,
  tempPath,
  withTempDir,
  writeBytes,
  writeChunks,
  writeTempFile,
  writeText,
};

export default platformSupport;
