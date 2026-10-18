import { Console, Effect, ManagedRuntime } from "effect";

import { validateGeneratedModelData } from "./model-data.ts";
import { ScriptFiles, scriptFilesLayer } from "./script-files.ts";

ManagedRuntime.make(scriptFilesLayer).runFork(
  Effect.gen(function* () {
    const files = yield* ScriptFiles;
    yield* validateGeneratedModelData(files.join(import.meta.dirname, ".."));
    yield* Console.log("Generated model data is valid.");
  }).pipe(
    Effect.catchTag(["ModelDataError", "ScriptFileError"], (error) =>
      Console.error(error.message).pipe(
        Effect.andThen(
          Console.error(
            "\nModel data is missing or stale. Run `vp run hydrate:model-data` from the repository root.",
          ),
        ),
        Effect.andThen(
          Effect.sync(() => {
            process.exitCode = 1;
          }),
        ),
      ),
    ),
  ),
);
