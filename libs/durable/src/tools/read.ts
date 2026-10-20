import { Effect } from "effect";
import { Type } from "typebox";

import define from "../harness/define.ts";
import type typesModule from "../harness/types.types.ts";
import truncate from "../truncate.ts";
import envModule from "./env.ts";
import readContentModule from "./read-content.ts";
import type readTextTypes from "./read-text.types.ts";
import type readTypes from "./read.types.ts";

const { defineTool } = define;
const { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } = truncate;
const { requireEnv, resolveReadToolPath } = envModule;
const { readContent } = readContentModule;

const readSchema = Type.Object({
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
});

function createReadTool(
  options: readTypes.ReadToolOptions = {},
): typesModule.ToolRegistration<typeof readSchema, readTextTypes.ReadToolDetails> {
  const formats = options.images === undefined ? "jpg, png, gif, webp" : "jpg, png, gif, webp, bmp";
  return defineTool({
    description: `Read the contents of a file. Supports text files and images (${formats}). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    execute(args, api, context) {
      const { path, offset, limit } = args;
      return Effect.runPromise(
        Effect.gen(function* () {
          const env = requireEnv(api);
          const absolutePath = yield* resolveReadToolPath(env, path, context);
          const request = { images: options.images, limit, offset, path };
          return yield* readContent(env, absolutePath, request, api, context);
        }),
      );
    },
    name: "read",
    parameters: readSchema,
  });
}

const read = {
  createReadTool,
  readSchema,
};

export default read;
