import * as NodeServices from "@effect/platform-node/NodeServices";
import { Context, Data, Effect, FileSystem, Layer, Path } from "effect";

export class ScriptFileError extends Data.TaggedError("ScriptFileError")<{
  readonly message: string;
}> {}

export interface TempDirectoryOptions {
  readonly directory?: string | undefined;
  readonly prefix: string;
}

export interface FileMove {
  readonly from: string;
  readonly to: string;
}

export interface FileWrite<A> {
  readonly path: string;
  readonly content: A;
}

export class ScriptFiles extends Context.Service<
  ScriptFiles,
  {
    readonly join: (...segments: readonly string[]) => string;
    readonly resolve: (path: string) => string;
    readonly readText: (path: string) => Effect.Effect<string, ScriptFileError>;
    readonly writeText: (file: FileWrite<string>) => Effect.Effect<void, ScriptFileError>;
    readonly writeBytes: (file: FileWrite<Uint8Array>) => Effect.Effect<void, ScriptFileError>;
    readonly list: (directory: string) => Effect.Effect<readonly string[], ScriptFileError>;
    readonly exists: (path: string) => Effect.Effect<boolean, ScriptFileError>;
    readonly isDirectory: (path: string) => Effect.Effect<boolean>;
    readonly makeDirectory: (path: string) => Effect.Effect<void, ScriptFileError>;
    readonly makeTempDirectory: (
      options: TempDirectoryOptions,
    ) => Effect.Effect<string, ScriptFileError>;
    readonly remove: (path: string) => Effect.Effect<void, ScriptFileError>;
    readonly rename: (move: FileMove) => Effect.Effect<void, ScriptFileError>;
  }
>()("@msa/ai/scripts/script-files/ScriptFiles") {}

const toScriptFileError = (error: { readonly message: string }) =>
  new ScriptFileError({ message: error.message });

export const scriptFilesLayer: Layer.Layer<ScriptFiles> = Layer.effect(
  ScriptFiles,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return ScriptFiles.of({
      join: (...segments) => path.join(...segments),
      resolve: (target) => path.resolve(target),
      readText: (target) => Effect.mapError(fs.readFileString(target), toScriptFileError),
      writeText: ({ path: target, content }) =>
        Effect.mapError(fs.writeFileString(target, content), toScriptFileError),
      writeBytes: ({ path: target, content }) =>
        Effect.mapError(fs.writeFile(target, content), toScriptFileError),
      list: (directory) => Effect.mapError(fs.readDirectory(directory), toScriptFileError),
      exists: (target) => Effect.mapError(fs.exists(target), toScriptFileError),
      isDirectory: (target) =>
        fs.stat(target).pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.orElseSucceed(() => false),
        ),
      makeDirectory: (target) =>
        Effect.mapError(fs.makeDirectory(target, { recursive: true }), toScriptFileError),
      makeTempDirectory: (options) =>
        Effect.mapError(fs.makeTempDirectory(options), toScriptFileError),
      remove: (target) =>
        Effect.mapError(fs.remove(target, { recursive: true, force: true }), toScriptFileError),
      rename: ({ from, to }) => Effect.mapError(fs.rename(from, to), toScriptFileError),
    });
  }),
).pipe(Layer.provide(NodeServices.layer));
