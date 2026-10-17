import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import type { FileSystem } from "../../env/index.ts";
import { JsonlCorruptionError } from "./corruption-error.ts";
import {
  type EncodedCommit,
  errorFromFile,
  MAIN_FILE,
  type ParsedFile,
  type ParsedLine,
} from "./format.ts";

const RECLAIM_SUFFIX = ".reclaim";
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export type JsonlFiles = {
  readonly fs: FileSystem;
  readonly directory: string;
  readonly mainPath: string;
  readonly fsync: boolean;
};

const decodeLine = (bytes: Uint8Array, name: string, lineNumber: number): string => {
  try {
    return textDecoder.decode(bytes);
  } catch (error) {
    throw new JsonlCorruptionError(
      `Invalid UTF-8 in complete ${name} line ${lineNumber}`,
      error instanceof Error ? error : undefined,
    );
  }
};

const splitLines = <T>(
  bytes: Uint8Array,
  completeSize: number,
  name: string,
  parse: (text: string, line: number) => T,
): ParsedLine<T>[] => {
  const lines: ParsedLine<T>[] = [];
  let start = 0;
  let lineNumber = 1;
  for (let end = 0; end < completeSize; end++) {
    if (bytes[end] !== 0x0a) continue;
    const text = decodeLine(bytes.subarray(start, end), name, lineNumber);
    lines.push({ value: parse(text, lineNumber), start });
    start = end + 1;
    lineNumber++;
  }
  return lines;
};

export const readLines: {
  <T>(
    path: string,
    name: string,
    context: Context,
    parse: (text: string, line: number) => T,
  ): (fs: FileSystem) => Effect.Effect<ParsedFile<T>>;
  <T>(
    fs: FileSystem,
    path: string,
    name: string,
    context: Context,
    parse: (text: string, line: number) => T,
  ): Effect.Effect<ParsedFile<T>>;
} = Function.dual(
  5,
  Effect.fnUntraced(function* <T>(
    fs: FileSystem,
    path: string,
    name: string,
    context: Context,
    parse: (text: string, line: number) => T,
  ) {
    const read = yield* Effect.promise(() => fs.readBinaryFile(path, context));
    if (!read.ok) {
      if (read.error.code === "not_found") return { path, lines: [] };
      throw errorFromFile(`read of ${name}`, read.error);
    }
    const bytes = read.value;
    let completeSize = bytes.length;
    if (completeSize > 0 && bytes[completeSize - 1] !== 0x0a) {
      completeSize = bytes.lastIndexOf(0x0a) + 1;
      const truncated = yield* Effect.promise(() => fs.truncateFile(path, completeSize, context));
      if (!truncated.ok) throw errorFromFile(`torn-line truncation of ${name}`, truncated.error);
    }
    return { path, lines: splitLines(bytes, completeSize, name, parse) };
  }),
);

const replaceWithContent = Effect.fnUntraced(function* (
  files: JsonlFiles,
  file: string,
  path: string,
  content: string,
  context: Context,
) {
  const { fs } = files;
  const temporaryPath = yield* Effect.promise(() =>
    fs.joinPath([files.directory, `${file}${RECLAIM_SUFFIX}`], context),
  );
  if (!temporaryPath.ok) return;
  const written = yield* Effect.promise(() => fs.writeFile(temporaryPath.value, content, context));
  if (!written.ok) return;
  if (files.fsync) {
    const flushed = yield* Effect.promise(() => fs.flushFile(temporaryPath.value, context));
    if (!flushed.ok) return;
  }
  yield* Effect.promise(() => fs.renameFile(temporaryPath.value, path, context));
});

const replaceSidecar = Effect.fnUntraced(function* (
  files: JsonlFiles,
  file: string,
  content: string,
  context: Context,
) {
  const path = yield* Effect.promise(() => files.fs.joinPath([files.directory, file], context));
  if (!path.ok) return;
  if (content === "") {
    yield* Effect.promise(() => files.fs.remove(path.value, { force: true }, context));
    return;
  }
  yield* replaceWithContent(files, file, path.value, content, context);
});

export const reclaimSidecars: {
  (
    replacements: ReadonlyMap<string, string>,
    context: Context,
  ): (files: JsonlFiles) => Effect.Effect<void>;
  (
    files: JsonlFiles,
    replacements: ReadonlyMap<string, string>,
    context: Context,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    files: JsonlFiles,
    replacements: ReadonlyMap<string, string>,
    context: Context,
  ) {
    if (replacements.size === 0) return;
    if (files.fsync) {
      const flushed = yield* Effect.promise(() => files.fs.flushFile(files.mainPath, context));
      if (!flushed.ok) return;
    }
    yield* Effect.forEach(
      replacements,
      ([file, content]) => replaceSidecar(files, file, content, context),
      { discard: true },
    );
  }),
);

export const resolveFile: {
  (file: string, context: Context): (files: JsonlFiles) => Effect.Effect<string>;
  (files: JsonlFiles, file: string, context: Context): Effect.Effect<string>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (files: JsonlFiles, file: string, context: Context) {
    const path = yield* Effect.promise(() => files.fs.joinPath([files.directory, file], context));
    if (!path.ok) throw errorFromFile("path join", path.error);
    return path.value;
  }),
);

type Layout = { readonly directory: string; readonly mainPath: string };

export const resolveLayout: {
  (fs: FileSystem, context: Context): (directory: string) => Effect.Effect<Layout>;
  (directory: string, fs: FileSystem, context: Context): Effect.Effect<Layout>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (directory: string, fs: FileSystem, context: Context) {
    const absolute = yield* Effect.promise(() => fs.absolutePath(directory, context));
    if (!absolute.ok) throw errorFromFile("path resolution", absolute.error);
    const created = yield* Effect.promise(() =>
      fs.createDir(absolute.value, { recursive: true }, context),
    );
    if (!created.ok) throw errorFromFile("directory creation", created.error);
    const mainPath = yield* Effect.promise(() => fs.joinPath([absolute.value, MAIN_FILE], context));
    if (!mainPath.ok) throw errorFromFile("path join", mainPath.error);
    return { directory: absolute.value, mainPath: mainPath.value };
  }),
);

type ResolvedSidecar = { readonly file: string; readonly content: string; readonly path: string };

const appendSidecars = Effect.fnUntraced(function* (
  files: JsonlFiles,
  sidecars: readonly ResolvedSidecar[],
  context: Context,
) {
  for (const sidecar of sidecars) {
    const result = yield* Effect.promise(() =>
      files.fs.appendFile(sidecar.path, sidecar.content, context),
    );
    if (!result.ok) return errorFromFile(`append to ${sidecar.file}`, result.error);
  }
  if (!files.fsync) return undefined;
  for (const sidecar of sidecars) {
    const result = yield* Effect.promise(() => files.fs.flushFile(sidecar.path, context));
    if (!result.ok) return errorFromFile(`flush of ${sidecar.file}`, result.error);
  }
  return undefined;
});

export const appendEncoded: {
  (
    encoded: EncodedCommit,
    context: Context,
  ): (files: JsonlFiles) => Effect.Effect<Error | undefined>;
  (files: JsonlFiles, encoded: EncodedCommit, context: Context): Effect.Effect<Error | undefined>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (files: JsonlFiles, encoded: EncodedCommit, context: Context) {
    const sidecars = yield* Effect.forEach(
      [...encoded.sidecars],
      ([file, content]) =>
        Effect.map(resolveFile(files, file, context), (path) => ({ file, content, path })),
      { concurrency: "unbounded" },
    );
    const failure = yield* appendSidecars(files, sidecars, context);
    if (failure !== undefined) return failure;
    const marker = yield* Effect.promise(() =>
      files.fs.appendFile(files.mainPath, encoded.marker, context),
    );
    return marker.ok ? undefined : errorFromFile(`append to ${MAIN_FILE}`, marker.error);
  }),
);
