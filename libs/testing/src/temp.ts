import { tmpdir } from "node:os";

import { Effect, FileSystem, Predicate, Schedule } from "effect";

import paths from "./paths.ts";
import runtime from "./runtime.ts";
import type tempTypes from "./temp.types.ts";

const { provideNode } = runtime;
const { joinPath } = paths;

const withFileSystem = <A, E>(
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E> =>
  provideNode(Effect.flatMap(FileSystem.FileSystem, (service) => use(service)));

const tempRoot = (): string => tmpdir();

const tempPath = (name: string): string => joinPath(tmpdir(), name);

const makeTempDir = (prefix: string): Effect.Effect<string> =>
  withFileSystem((service) => service.makeTempDirectory({ prefix })).pipe(Effect.orDie);

const makeTempFile = Effect.fn("makeTempFile")(function* (prefix: string, name: string) {
  const directory = yield* makeTempDir(prefix);
  return { directory, path: joinPath(directory, name) } satisfies tempTypes.TempFile;
});

const retriable = (error: { readonly reason?: unknown }): boolean =>
  Predicate.isTagged(error.reason, "Busy") ||
  Predicate.isTagged(error.reason, "PermissionDenied") ||
  Predicate.isTagged(error.reason, "Unknown");

const remove = (directory: string) =>
  withFileSystem((service) => service.remove(directory, { force: true, recursive: true }));

const removeDir = (directory: string): Effect.Effect<void> => Effect.orDie(remove(directory));

const removeDirRetrying = (directory: string): Effect.Effect<void> =>
  Effect.orDie(
    remove(directory).pipe(
      Effect.retry({ schedule: Schedule.spaced(100), times: 80, while: retriable }),
    ),
  );

const removeDirs = (directories: Iterable<string>): Effect.Effect<void> =>
  Effect.forEach(directories, removeDir, { discard: true });

const temp = {
  makeTempDir,
  makeTempFile,
  removeDir,
  removeDirRetrying,
  removeDirs,
  tempPath,
  tempRoot,
};

export default temp;
