import { Effect } from "effect";
import { Type } from "typebox";

import resultModule from "../env/result.ts";
import define from "../harness/define.ts";
import type typesModule from "../harness/types.types.ts";
import envModule from "./env.ts";

const { defineTool } = define;
const { fileMutation, requireEnv, resolveToolPath } = envModule;
const { getOrThrow } = resultModule;

const writeSchema = Type.Object({
  content: Type.String({ description: "Content to write to the file" }),
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
});

function createWriteTool(): typesModule.ToolRegistration<typeof writeSchema> {
  return defineTool({
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    execute(args, api, context) {
      const { path, content } = args;
      const aborted = (): void => {
        if (context.abortSignal?.aborted === true) throw new Error("Operation aborted");
      };
      return Effect.runPromise(
        Effect.gen(function* () {
          const env = requireEnv(api);
          const absolutePath = yield* resolveToolPath(env, path, context);
          const write = Effect.gen(function* () {
            aborted();
            getOrThrow(yield* Effect.promise(() => env.writeFile(absolutePath, content, context)));
            aborted();
            return { output: [{ text: `Successfully wrote to ${path}`, type: "text" as const }] };
          });
          return yield* fileMutation(env, absolutePath, write, context);
        }),
      );
    },
    name: "write",
    parameters: writeSchema,
  });
}

const writeModule = {
  createWriteTool,
  writeSchema,
};

export default writeModule;
