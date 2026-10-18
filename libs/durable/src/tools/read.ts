import { Effect } from "effect";
import { type Static, Type } from "typebox";

import { defineTool } from "../harness/define.ts";
import type { ToolRegistration } from "../harness/types.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "../truncate.ts";
import { requireEnv, resolveReadToolPath } from "./env.ts";
import type { ImageProcessor } from "./image.ts";
import { readContent } from "./read-content.ts";
import type { ReadToolDetails } from "./read-text.ts";

export type { ReadToolDetails } from "./read-text.ts";

const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export type ReadToolOptions = {
  readonly images?: ImageProcessor;
};

export function createReadTool(
  options: ReadToolOptions = {},
): ToolRegistration<typeof readSchema, ReadToolDetails> {
  const formats = options.images === undefined ? "jpg, png, gif, webp" : "jpg, png, gif, webp, bmp";
  return defineTool({
    name: "read",
    description: `Read the contents of a file. Supports text files and images (${formats}). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    parameters: readSchema,
    execute(args, api, context) {
      const { path, offset, limit } = args;
      return Effect.runPromise(
        Effect.gen(function* () {
          const env = requireEnv(api);
          const absolutePath = yield* resolveReadToolPath(env, path, context);
          const request = { path, offset, limit, images: options.images };
          return yield* readContent(env, absolutePath, request, api, context);
        }),
      );
    },
  });
}
