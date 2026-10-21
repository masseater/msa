import { Effect, ManagedRuntime } from "effect";
import { it } from "vite-plus/test";

import modelData from "../scripts/model-data.ts";
import scriptFiles from "../scripts/script-files.ts";

const { validateGeneratedModelData } = modelData;
const { ScriptFiles, scriptFilesLayer } = scriptFiles;

const runtime = ManagedRuntime.make(scriptFilesLayer);

const validate = Effect.gen(function* () {
  const files = yield* ScriptFiles;
  yield* validateGeneratedModelData(files.join(import.meta.dirname, ".."));
});

it("keeps src/providers/data in sync with the generated catalog", () =>
  runtime.runPromise(validate));
