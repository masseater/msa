import { Effect } from "effect";
import { type Static, Type } from "typebox";

import { getOrThrow } from "../env/result.ts";
import { defineTool } from "../harness/define.ts";
import type { ToolRegistration } from "../harness/types.ts";
import { fileMutation, requireEnv, resolveToolPath } from "./env.ts";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

export function createWriteTool(): ToolRegistration<typeof writeSchema> {
  return defineTool({
    name: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeSchema,
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
            return { output: [{ type: "text" as const, text: `Successfully wrote to ${path}` }] };
          });
          return yield* fileMutation(env, absolutePath, write, context);
        }),
      );
    },
  });
}
