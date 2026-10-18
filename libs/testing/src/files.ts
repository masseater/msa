import { Effect, FileSystem } from "effect";

import { provideNode } from "./runtime.ts";

const withFileSystem = <A, E>(
  use: (service: FileSystem.FileSystem) => Effect.Effect<A, E, never>,
): Effect.Effect<A, E> =>
  provideNode(Effect.flatMap(FileSystem.FileSystem, (service) => use(service)));

export const readTextFile = (file: string): Effect.Effect<string> =>
  withFileSystem((service) => service.readFileString(file)).pipe(Effect.orDie);

export const readBytesFile = (file: string): Effect.Effect<Uint8Array> =>
  withFileSystem((service) => service.readFile(file)).pipe(Effect.orDie);

export const writeTextFile = Effect.fn("writeTextFile")(function* (file: string, content: string) {
  yield* withFileSystem((service) => service.writeFileString(file, content)).pipe(Effect.orDie);
});

export const writeBytesFile = Effect.fn("writeBytesFile")(function* (
  file: string,
  content: Uint8Array,
) {
  yield* withFileSystem((service) => service.writeFile(file, content)).pipe(Effect.orDie);
});

export const appendTextFile = Effect.fn("appendTextFile")(function* (
  file: string,
  content: string,
) {
  yield* withFileSystem((service) => service.writeFileString(file, content, { flag: "a" })).pipe(
    Effect.orDie,
  );
});

export const pathExists = (file: string): Effect.Effect<boolean> =>
  withFileSystem((service) => service.exists(file)).pipe(Effect.orDie);

export const readDirectory = (directory: string): Effect.Effect<ReadonlyArray<string>> =>
  withFileSystem((service) => service.readDirectory(directory)).pipe(Effect.orDie);

export const makeDirectory = (directory: string): Effect.Effect<void> =>
  withFileSystem((service) => service.makeDirectory(directory, { recursive: true })).pipe(
    Effect.orDie,
  );

export const copyFile = Effect.fn("copyFile")(function* (from: string, to: string) {
  yield* withFileSystem((service) => service.copyFile(from, to)).pipe(Effect.orDie);
});

export const changeMode = Effect.fn("changeMode")(function* (file: string, mode: number) {
  yield* withFileSystem((service) => service.chmod(file, mode)).pipe(Effect.orDie);
});

export const fileSize = (file: string): Effect.Effect<bigint> =>
  withFileSystem((service) => service.stat(file)).pipe(
    Effect.orDie,
    Effect.map((info) => info.size),
  );

export const removePath = (target: string): Effect.Effect<void> =>
  withFileSystem((service) => service.remove(target, { recursive: true, force: true })).pipe(
    Effect.orDie,
  );
