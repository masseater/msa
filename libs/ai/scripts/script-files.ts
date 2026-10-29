import { Context, Effect, Layer } from "effect";

import scriptOutput from "../src/utils/script-output.ts";
import ScriptFileError from "./script-file-error.ts";
import type scriptFilesTypes from "./script-files.types.ts";

class ScriptFiles extends Context.Service<
  ScriptFiles,
  {
    readonly join: (...segments: readonly string[]) => string;
    readonly resolve: (path: string) => string;
    readonly readText: (path: string) => Effect.Effect<string, ScriptFileError>;
    readonly writeTextFile: (
      file: scriptFilesTypes.FileWrite<string>,
    ) => Effect.Effect<void, ScriptFileError>;
    readonly writeBinaryFile: (
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
    readonly renamePath: (move: scriptFilesTypes.FileMove) => Effect.Effect<void, ScriptFileError>;
  }
>()("@msa/ai/scripts/script-files/ScriptFiles") {}

const toScriptFileError = (error: { readonly message: string }) =>
  ScriptFileError.make({ message: error.message });

const scriptFilesLayer: Layer.Layer<ScriptFiles> = Layer.effect(
  ScriptFiles,
  Effect.gen(function* () {
    const output = yield* scriptOutput.ScriptOutput;
    const { files: fs, path } = output;
    return ScriptFiles.of({
      exists: (target) => Effect.mapError(fs.exists(target), toScriptFileError),
      isDirectory: (target) =>
        fs.stat(target).pipe(
          Effect.map((info) => info.isDirectory),
          Effect.orElseSucceed(() => false),
        ),
      join: (...segments) => path.join(...segments),
      list: (directory) => Effect.mapError(fs.readDirectory(directory), toScriptFileError),
      makeDirectory: (target) => Effect.mapError(fs.makeDirectory(target), toScriptFileError),
      makeTempDirectory: (options) =>
        Effect.mapError(fs.makeTempDirectory(options.prefix, options.directory), toScriptFileError),
      readText: (target) => Effect.mapError(fs.readText(target), toScriptFileError),
      remove: (target) => Effect.mapError(fs.remove(target), toScriptFileError),
      renamePath: ({ from, to }) => output.movePath(from, to),
      resolve: (target) => path.resolve(target),
      writeBinaryFile: ({ path: target, content }) => output.writeBinaryFile(target, content),
      writeTextFile: ({ path: target, content }) => output.writeTextFile(target, content),
    });
  }),
).pipe(Layer.provide(scriptOutput.scriptOutputLayer));

const scriptFiles = {
  ScriptFiles,
  scriptFilesLayer,
};

export default scriptFiles;
