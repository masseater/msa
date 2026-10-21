import { Effect, FileSystem, Option } from "effect";

import runtime from "./runtime.ts";

const { provideNode } = runtime;

const withFileSystem = <A, E>(
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E> =>
  provideNode(Effect.flatMap(FileSystem.FileSystem, (service) => use(service)));

const readTextFile = (file: string): Effect.Effect<string> =>
  withFileSystem((service) => service.readFileString(file)).pipe(Effect.orDie);

const readBytesFile = (file: string): Effect.Effect<Uint8Array> =>
  withFileSystem((service) => service.readFile(file)).pipe(Effect.orDie);

const writeTextFile = Effect.fn("writeTextFile")(function* (file: string, content: string) {
  yield* withFileSystem((service) => service.writeFileString(file, content)).pipe(Effect.orDie);
});

const writeBytesFile = Effect.fn("writeBytesFile")(function* (file: string, content: Uint8Array) {
  yield* withFileSystem((service) => service.writeFile(file, content)).pipe(Effect.orDie);
});

const appendTextFile = Effect.fn("appendTextFile")(function* (file: string, content: string) {
  yield* withFileSystem((service) => service.writeFileString(file, content, { flag: "a" })).pipe(
    Effect.orDie,
  );
});

const fileMode = (file: string): Effect.Effect<number> =>
  withFileSystem((service) => service.stat(file)).pipe(
    Effect.map((info) => info.mode),
    Effect.orDie,
  );

const fileModifiedMillis = (file: string): Effect.Effect<number> =>
  withFileSystem((service) => service.stat(file)).pipe(
    Effect.map((info) =>
      Option.getOrElse(
        Option.map(info.mtime, (date) => date.getTime()),
        () => 0,
      ),
    ),
    Effect.orDie,
  );

const makeSymlink = (target: string, link: string): Effect.Effect<void> =>
  withFileSystem((service) => service.symlink(target, link)).pipe(Effect.orDie);

const realPath = (target: string): Effect.Effect<string> =>
  withFileSystem((service) => service.realPath(target)).pipe(Effect.orDie);

const pathExists = (file: string): Effect.Effect<boolean> =>
  withFileSystem((service) => service.exists(file)).pipe(Effect.orDie);

const readDirectory = (directory: string): Effect.Effect<ReadonlyArray<string>> =>
  withFileSystem((service) => service.readDirectory(directory)).pipe(Effect.orDie);

const readDirectoryRecursive = (directory: string): Effect.Effect<ReadonlyArray<string>> =>
  withFileSystem((service) => service.readDirectory(directory, { recursive: true })).pipe(
    Effect.orDie,
  );

const renamePath = (from: string, to: string): Effect.Effect<void> =>
  withFileSystem((service) => service.rename(from, to)).pipe(Effect.orDie);

const makeDirectory = (directory: string): Effect.Effect<void> =>
  withFileSystem((service) => service.makeDirectory(directory, { recursive: true })).pipe(
    Effect.orDie,
  );

const copyFile = Effect.fn("copyFile")(function* (from: string, to: string) {
  yield* withFileSystem((service) => service.copyFile(from, to)).pipe(Effect.orDie);
});

const changeMode = Effect.fn("changeMode")(function* (file: string, mode: number) {
  yield* withFileSystem((service) => service.chmod(file, mode)).pipe(Effect.orDie);
});

const fileSize = (file: string): Effect.Effect<bigint> =>
  withFileSystem((service) => service.stat(file)).pipe(
    Effect.orDie,
    Effect.map((info) => info.size),
  );

const removePath = (target: string): Effect.Effect<void> =>
  withFileSystem((service) => service.remove(target, { force: true, recursive: true })).pipe(
    Effect.orDie,
  );

const files = {
  appendTextFile,
  changeMode,
  copyFile,
  fileMode,
  fileModifiedMillis,
  fileSize,
  makeDirectory,
  makeSymlink,
  pathExists,
  readBytesFile,
  readDirectory,
  readDirectoryRecursive,
  readTextFile,
  realPath,
  removePath,
  renamePath,
  writeBytesFile,
  writeTextFile,
};

export default files;
