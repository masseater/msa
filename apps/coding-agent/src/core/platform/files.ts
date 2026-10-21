import { Effect, FileSystem, Option } from "effect";

import type platformTypes from "./index.types.ts";
import platformRuntime from "./runtime.ts";

const run = <A, E>(use: (fileSystem: FileSystem.FileSystem) => Effect.Effect<A, E>): Promise<A> =>
  platformRuntime.runPromise(FileSystem.FileSystem.use(use));

const exists = (path: string): Promise<boolean> => run((fileSystem) => fileSystem.exists(path));

const access = (path: string, options?: { readonly writable?: boolean }): Promise<void> =>
  run((fileSystem) => fileSystem.access(path, options));

const fileSize = (path: string): Promise<number> =>
  run((fileSystem) => Effect.map(fileSystem.stat(path), (info) => Number(info.size)));

type StatInfo = Effect.Success<ReturnType<FileSystem.FileSystem["stat"]>>;

const fileInfo = (info: StatInfo): platformTypes.FileInfo => ({
  isDirectory: info.type === "Directory",
  isFile: info.type === "File",
  mtimeMs: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
  size: Number(info.size),
});

const stat = (path: string): Promise<platformTypes.FileInfo> =>
  run((fileSystem) => Effect.map(fileSystem.stat(path), fileInfo));

const readDirectory = (path: string): Promise<readonly string[]> =>
  run((fileSystem) => fileSystem.readDirectory(path));

const realPath = (path: string): Promise<string> => run((fileSystem) => fileSystem.realPath(path));

const appendText = (options: { path: string; data: string }): Promise<void> =>
  run((fileSystem) => fileSystem.writeFileString(options.path, options.data, { flag: "a" }));

const chmod = (options: { path: string; mode: number }): Promise<void> =>
  run((fileSystem) => fileSystem.chmod(options.path, options.mode));

const glob = (pattern: string, root: string): Promise<readonly string[]> =>
  run((fileSystem) => fileSystem.glob(pattern, { root }));

const makeTempDirectory = (prefix: string): Promise<string> =>
  run((fileSystem) => fileSystem.makeTempDirectory({ prefix }));

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
  appendText,
  chmod,
  copyFile,
  exists,
  fileSize,
  glob,
  makeDirectory,
  makeTempDirectory,
  readDirectory,
  readFile,
  readHead,
  readText,
  realPath,
  remove,
  rename,
  stat,
  writeFile,
};

export default platformFiles;
