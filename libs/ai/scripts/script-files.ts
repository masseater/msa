import * as NodeServices from "@effect/platform-node/NodeServices";
import { Context, Effect, FileSystem, Layer, Path } from "effect";

import ScriptFileError from "./script-file-error.ts";
import type scriptFilesTypes from "./script-files.types.ts";

class ScriptFiles extends Context.Service<
  ScriptFiles,
  {
    readonly join: (...segments: readonly string[]) => string;
    readonly resolve: (path: string) => string;
    readonly readText: (path: string) => Effect.Effect<string, ScriptFileError>;
    readonly writeText: (
      file: scriptFilesTypes.FileWrite<string>,
    ) => Effect.Effect<void, ScriptFileError>;
    readonly writeBytes: (
      file: scriptFilesTypes.FileWrite<Uint8Array>,
    ) => Effect.Effect<void, ScriptFileError>;
    readonly list: (directory: string) => Effect.Effect<readonly string[], ScriptFileError>;
    readonly exists: (path: string) => Effect.Effect<boolean, ScriptFileError>;
    readonly isDirectory: (path: string) => Effect.Effect<boolean>;
    readonly makeDirectory: (path: string) => Effect.Effect<void, ScriptFileError>;
    readonly makeTempDirectory: (
      options: scriptFilesTypes.TempDirectoryOptions,
    ) => Effect.Effect<string, ScriptFileError>;
    readonly remove: (path: string) => Effect.Effect<void, ScriptFileError>;
    readonly rename: (move: scriptFilesTypes.FileMove) => Effect.Effect<void, ScriptFileError>;
  }
>()("@msa/ai/scripts/script-files/ScriptFiles") {}

const toScriptFileError = (error: { readonly message: string }) =>
  ScriptFileError.make({ message: error.message });

const scriptFilesLayer: Layer.Layer<ScriptFiles> = Layer.effect(
  ScriptFiles,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return ScriptFiles.of({
      exists: (target) => Effect.mapError(fs.exists(target), toScriptFileError),
      isDirectory: (target) =>
        fs.stat(target).pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.orElseSucceed(() => false),
        ),
      join: (...segments) => path.join(...segments),
      list: (directory) => Effect.mapError(fs.readDirectory(directory), toScriptFileError),
      makeDirectory: (target) =>
        Effect.mapError(fs.makeDirectory(target, { recursive: true }), toScriptFileError),
      makeTempDirectory: (options) =>
        Effect.mapError(fs.makeTempDirectory(options), toScriptFileError),
      readText: (target) => Effect.mapError(fs.readFileString(target), toScriptFileError),
      remove: (target) =>
        Effect.mapError(fs.remove(target, { force: true, recursive: true }), toScriptFileError),
      rename: ({ from, to }) => Effect.mapError(fs.rename(from, to), toScriptFileError),
      resolve: (target) => path.resolve(target),
      writeBytes: ({ path: target, content }) =>
        Effect.mapError(fs.writeFile(target, content), toScriptFileError),
      writeText: ({ path: target, content }) =>
        Effect.mapError(fs.writeFileString(target, content), toScriptFileError),
    });
  }),
).pipe(Layer.provide(NodeServices.layer));

const scriptFiles = {
  ScriptFiles,
  scriptFilesLayer,
};

export default scriptFiles;
