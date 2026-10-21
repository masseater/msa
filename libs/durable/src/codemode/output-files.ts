import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import type dualTypes from "../dual.ts";
import type envTypes from "../env/index.types.ts";
import errors from "../errors.ts";
import type typesModule from "../harness/types.types.ts";
import type outputTypes from "./output.types.ts";
import runDocs from "./run-docs.ts";

const { CodemodeRunDoc, commitWith } = runDocs;
const { errorMessage } = errors;

const outputDir = Effect.fnUntraced(function* (
  api: typesModule.ToolExecutionApi,
  context: chordTypes.Context,
  env: envTypes.ExecutionEnv,
) {
  const recorded = yield* commitWith(api, context, (tx) =>
    Effect.map(
      Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId)),
      (run) => run.outputDir,
    ),
  );
  if (recorded !== undefined) return recorded;
  const created = yield* Effect.promise(() => env.createTempDir("msa-codemode-", context));
  if (!created.ok) throw new Error(created.error.message);
  return yield* commitWith(api, context, (tx) =>
    Effect.map(
      Effect.promise(() => tx.doc(CodemodeRunDoc, api.taskId)),
      (run) => {
        run.outputDir ??= created.value;
        return run.outputDir;
      },
    ),
  );
});

const outputFilesOf = (
  api: typesModule.ToolExecutionApi,
  context: chordTypes.Context,
): outputTypes.OutputFile => {
  const env = api.env;
  let directory: Promise<string> | undefined;
  return (name, data) => {
    if (env === undefined) return Promise.resolve({ error: "no execution environment" });
    directory ??= Effect.runPromise(outputDir(api, context, env));
    const pending = directory;
    return Effect.runPromise(
      Effect.gen(function* () {
        const path = `${yield* Effect.promise(() => pending)}/${name}`;
        const written = yield* Effect.promise(() => env.writeFile(path, data, context));
        return written.ok ? { path } : { error: written.error.message };
      }).pipe(Effect.catchDefect((error) => Effect.succeed({ error: errorMessage(error) }))),
    );
  };
};

const outputFiles: dualTypes.Dual2<
  typesModule.ToolExecutionApi,
  chordTypes.Context,
  outputTypes.OutputFile
> = Function.dual(2, outputFilesOf);

const outputFilesModule = {
  outputFiles,
};

export default outputFilesModule;
