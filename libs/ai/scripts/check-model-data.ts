import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Console, Effect } from "effect";

import { validateGeneratedModelData } from "./model-data.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

Effect.runFork(
  Effect.sync(() => validateGeneratedModelData(packageRoot)).pipe(
    Effect.andThen(Console.log("Generated model data is valid.")),
    Effect.catchDefect((error) =>
      Console.error(error instanceof Error ? error.message : String(error)).pipe(
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
