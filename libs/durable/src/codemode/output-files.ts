import type { Context } from "@msa/chord";
import { Effect, Function } from "effect";

import type { Dual2 } from "../dual.ts";
import type { ExecutionEnv } from "../env/index.ts";
import { errorMessage } from "../errors.ts";
import type { ToolExecutionApi } from "../harness/types.ts";
import type { OutputFile } from "./output.ts";
import { CodemodeRunDoc, commitWith } from "./run-docs.ts";

const outputDir = Effect.fnUntraced(function* (
  api: ToolExecutionApi,
  context: Context,
  env: ExecutionEnv,
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

const outputFilesOf = (api: ToolExecutionApi, context: Context): OutputFile => {
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

export const outputFiles: Dual2<ToolExecutionApi, Context, OutputFile> = Function.dual(
  2,
  outputFilesOf,
);
