import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import type envTypes from "../../env/index.types.ts";
import JsonlCorruptionError from "./corruption-error.ts";
import type filesTypes from "./files.types.ts";
import formatModule from "./format.ts";
import type formatTypes from "./format.types.ts";

const { MAIN_FILE, errorFromFile } = formatModule;

const RECLAIM_SUFFIX = ".reclaim";
const textDecoder = new TextDecoder("utf-8", { fatal: true });

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
): formatTypes.ParsedLine<T>[] => {
  const lines: formatTypes.ParsedLine<T>[] = [];
  let start = 0;
  let lineNumber = 1;
  for (let end = 0; end < completeSize; end++) {
    if (bytes[end] !== 0x0a) continue;
    const text = decodeLine(bytes.subarray(start, end), name, lineNumber);
    lines.push({ start, value: parse(text, lineNumber) });
    start = end + 1;
    lineNumber++;
  }
  return lines;
};

const readLines: {
  <T>(
    path: string,
    name: string,
    context: Context,
    parse: (text: string, line: number) => T,
  ): (fs: envTypes.FileSystem) => Effect.Effect<formatTypes.ParsedFile<T>>;
  <T>(
    fs: envTypes.FileSystem,
    path: string,
    name: string,
    context: Context,
    parse: (text: string, line: number) => T,
  ): Effect.Effect<formatTypes.ParsedFile<T>>;
} = Function.dual(
  5,
  Effect.fnUntraced(function* <T>(
    fs: envTypes.FileSystem,
    path: string,
    name: string,
    context: Context,
    parse: (text: string, line: number) => T,
  ) {
    const read = yield* Effect.promise(() => fs.readBinaryFile(path, context));
    if (!read.ok) {
      if (read.error.code === "not_found") return { lines: [], path };
      throw errorFromFile(`read of ${name}`, read.error);
    }
    const bytes = read.value;
    let completeSize = bytes.length;
    if (completeSize > 0 && bytes[completeSize - 1] !== 0x0a) {
      completeSize = bytes.lastIndexOf(0x0a) + 1;
      const truncated = yield* Effect.promise(() => fs.truncateFile(path, completeSize, context));
      if (!truncated.ok) throw errorFromFile(`torn-line truncation of ${name}`, truncated.error);
    }
    return { lines: splitLines(bytes, completeSize, name, parse), path };
  }),
);

const replaceWithContent = Effect.fnUntraced(function* (
  files: filesTypes.JsonlFiles,
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
  files: filesTypes.JsonlFiles,
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

const reclaimSidecars: {
  (
    replacements: ReadonlyMap<string, string>,
    context: Context,
  ): (files: filesTypes.JsonlFiles) => Effect.Effect<void>;
  (
    files: filesTypes.JsonlFiles,
    replacements: ReadonlyMap<string, string>,
    context: Context,
  ): Effect.Effect<void>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    files: filesTypes.JsonlFiles,
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

const resolveFile: {
  (file: string, context: Context): (files: filesTypes.JsonlFiles) => Effect.Effect<string>;
  (files: filesTypes.JsonlFiles, file: string, context: Context): Effect.Effect<string>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (files: filesTypes.JsonlFiles, file: string, context: Context) {
    const path = yield* Effect.promise(() => files.fs.joinPath([files.directory, file], context));
    if (!path.ok) throw errorFromFile("path join", path.error);
    return path.value;
  }),
);

type Layout = { readonly directory: string; readonly mainPath: string };

const resolveLayout: {
  (fs: envTypes.FileSystem, context: Context): (directory: string) => Effect.Effect<Layout>;
  (directory: string, fs: envTypes.FileSystem, context: Context): Effect.Effect<Layout>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (directory: string, fs: envTypes.FileSystem, context: Context) {
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
  files: filesTypes.JsonlFiles,
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

const appendEncoded: {
  (
    encoded: formatTypes.EncodedCommit,
    context: Context,
  ): (files: filesTypes.JsonlFiles) => Effect.Effect<Error | undefined>;
  (
    files: filesTypes.JsonlFiles,
    encoded: formatTypes.EncodedCommit,
    context: Context,
  ): Effect.Effect<Error | undefined>;
} = Function.dual(
  3,
  Effect.fnUntraced(function* (
    files: filesTypes.JsonlFiles,
    encoded: formatTypes.EncodedCommit,
    context: Context,
  ) {
    const sidecars = yield* Effect.forEach(
      [...encoded.sidecars],
      ([file, content]) =>
        Effect.map(resolveFile(files, file, context), (path) => ({ content, file, path })),
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

const filesModule = {
  appendEncoded,
  readLines,
  reclaimSidecars,
  resolveFile,
  resolveLayout,
};

export default filesModule;
