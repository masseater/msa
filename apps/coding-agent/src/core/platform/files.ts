import { Effect, FileSystem } from "effect";

import platformRuntime from "./runtime.ts";

const run = <A, E>(use: (fileSystem: FileSystem.FileSystem) => Effect.Effect<A, E>): Promise<A> =>
  platformRuntime.runPromise(FileSystem.FileSystem.use(use));

const exists = (path: string): Promise<boolean> => run((fileSystem) => fileSystem.exists(path));

const access = (path: string): Promise<void> => run((fileSystem) => fileSystem.access(path));

const fileSize = (path: string): Promise<number> =>
  run((fileSystem) => Effect.map(fileSystem.stat(path), (info) => Number(info.size)));

const readFile = (path: string): Promise<Uint8Array> =>
  run((fileSystem) => fileSystem.readFile(path));

const readText = (path: string): Promise<string> =>
  run((fileSystem) => fileSystem.readFileString(path));

const readHead = (options: { path: string; length: number }): Promise<Uint8Array> =>
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

const writeFile = (options: {
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

const makeDirectory = (options: { path: string; mode?: number | undefined }): Promise<void> =>
  run((fileSystem) =>
    fileSystem.makeDirectory(options.path, {
      recursive: true,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
    }),
  );

const remove = (options: {
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

const rename = (options: { from: string; to: string }): Promise<void> =>
  run((fileSystem) => fileSystem.rename(options.from, options.to));

const copyFile = (options: { from: string; to: string }): Promise<void> =>
  run((fileSystem) => fileSystem.copyFile(options.from, options.to));

const platformFiles = {
  access,
  copyFile,
  exists,
  fileSize,
  makeDirectory,
  readFile,
  readHead,
  readText,
  remove,
  rename,
  writeFile,
};

export default platformFiles;
