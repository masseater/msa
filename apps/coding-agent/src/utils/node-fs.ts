import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem, ManagedRuntime } from "effect";

const runtime = ManagedRuntime.make(NodeFileSystem.layer);

const run = <A, E>(use: (fileSystem: FileSystem.FileSystem) => Effect.Effect<A, E>): Promise<A> =>
  runtime.runPromise(FileSystem.FileSystem.use(use));

export const exists = (path: string): Promise<boolean> =>
  run((fileSystem) => fileSystem.exists(path));

export const access = (path: string): Promise<void> => run((fileSystem) => fileSystem.access(path));

export const fileSize = (path: string): Promise<number> =>
  run((fileSystem) => Effect.map(fileSystem.stat(path), (info) => Number(info.size)));

export const readFile = (path: string): Promise<Uint8Array> =>
  run((fileSystem) => fileSystem.readFile(path));

export const readText = (path: string): Promise<string> =>
  run((fileSystem) => fileSystem.readFileString(path));

export const readHead = (options: { path: string; length: number }): Promise<Uint8Array> =>
  run((fileSystem) =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fileSystem.open(options.path, { flag: "r" });
        const buffer = new Uint8Array(options.length);
        const bytesRead = yield* file.read(buffer);
        return buffer.subarray(0, Number(bytesRead));
      }),
    ),
  );

export const writeFile = (options: {
  path: string;
  data: string | Uint8Array;
  mode?: number | undefined;
  flag?: "w" | "wx" | undefined;
}): Promise<void> =>
  run((fileSystem) =>
    fileSystem.writeFile(
      options.path,
      typeof options.data === "string" ? new TextEncoder().encode(options.data) : options.data,
      {
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.flag === undefined ? {} : { flag: options.flag }),
      },
    ),
  );

export const makeDirectory = (options: {
  path: string;
  mode?: number | undefined;
}): Promise<void> =>
  run((fileSystem) =>
    fileSystem.makeDirectory(options.path, {
      recursive: true,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    }),
  );

export const remove = (options: {
  path: string;
  recursive?: boolean | undefined;
  force?: boolean | undefined;
}): Promise<void> =>
  run((fileSystem) =>
    fileSystem.remove(options.path, {
      ...(options.recursive === undefined ? {} : { recursive: options.recursive }),
      ...(options.force === undefined ? {} : { force: options.force }),
    }),
  );

export const rename = (options: { from: string; to: string }): Promise<void> =>
  run((fileSystem) => fileSystem.rename(options.from, options.to));

export const copyFile = (options: { from: string; to: string }): Promise<void> =>
  run((fileSystem) => fileSystem.copyFile(options.from, options.to));
