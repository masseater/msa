import { Effect, ManagedRuntime } from "effect";
import { it } from "vite-plus/test";

import { validateGeneratedModelData } from "../scripts/model-data.ts";
import { ScriptFiles, scriptFilesLayer } from "../scripts/script-files.ts";

const runtime = ManagedRuntime.make(scriptFilesLayer);

const validate = Effect.gen(function* () {
  const files = yield* ScriptFiles;
  yield* validateGeneratedModelData(files.join(import.meta.dirname, ".."));
});

it("keeps src/providers/data in sync with the generated catalog", () =>
  runtime.runPromise(validate));
