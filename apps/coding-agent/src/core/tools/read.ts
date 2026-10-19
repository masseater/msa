import type { AgentTool } from "@msa/agent-core";
import { Effect, FileSystem } from "effect";

import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import {
  abortedBy,
  fromPromise,
  nonEmptyOr,
  platformRuntime,
  rethrowCause,
  unwrapForeign,
} from "../platform/index.ts";
import { resolveReadPathAsync } from "./path-utils.ts";
import {
  readDescription,
  readImageContent,
  type ReadOperations,
  readOutputSchema,
  readSchema,
  readTextContent,
  type ReadToolDetails,
  type ReadToolOptions,
  readToolSystemPromptContribution,
  toReadOutput,
} from "./read-content.ts";
import { readRenderers } from "./renderers/read.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";

export {
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  type ReadToolOptions,
  type ReadToolOutput,
  readToolSystemPromptContribution,
} from "./read-content.ts";

const defaultReadOperations: ReadOperations = {
  readFile: (path) =>
    platformRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
          Effect.map((bytes) => Buffer.from(bytes)),
        ),
      ),
    ),
  access: (path) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true }))),
    ),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

interface ReadRequest {
  ops: ReadOperations;
  options: ReadToolOptions | undefined;
  cwd: string;
  path: string;
  offset: number | undefined;
  limit: number | undefined;
  ctx: ExtensionContext | undefined;
}

const readFileTool = Effect.fn("read")(function* (request: ReadRequest) {
  const { ops, options, ctx } = request;
  const absolutePath = yield* fromPromise(() =>
    resolveReadPathAsync(request.path, nonEmptyOr(ctx?.cwd, request.cwd)),
  );
  yield* fromPromise(() => ops.access(absolutePath));
  const mimeType = yield* fromPromise(() => ops.detectImageMimeType?.(absolutePath));
  if (mimeType !== undefined && mimeType !== null && mimeType !== "") {
    const content = yield* readImageContent({
      ops,
      absolutePath,
      mimeType,
      autoResizeImages: options?.autoResizeImages ?? true,
      resizeOptions: ctx?.model?.inputLimits?.images?.resize ?? options?.resizeOptions,
      model: ctx?.model,
    });
    return { content, details: undefined as ReadToolDetails | undefined };
  }
  const buffer = yield* fromPromise(() => ops.readFile(absolutePath));
  return yield* readTextContent({
    buffer,
    path: request.path,
    offset: request.offset,
    limit: request.limit,
  });
});

const createReadToolDefinitionImpl = (
  cwd: string,
  options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails | undefined> => {
  const ops = options?.operations ?? defaultReadOperations;
  return {
    name: "read",
    label: "read",
    description: readDescription,
    promptSnippet: readToolSystemPromptContribution.snippet,
    promptGuidelines: [...readToolSystemPromptContribution.guidelines],
    parameters: readSchema,
    annotations: { readOnlyHint: true },
    outputSchema: readOutputSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    execute: (
      _toolCallId,
      { path, offset, limit }: { path: string; offset?: number; limit?: number },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: ExtensionContext,
    ) =>
      platformRuntime.runPromise(
        unwrapForeign(
          readFileTool({ ops, options, cwd, path, offset, limit, ctx }).pipe(
            abortedBy(signal),
            Effect.map((result) => ({
              content: result.content,
              details: result.details,
              structuredContent: toReadOutput(result.content),
            })),
          ),
        ),
      ),
    ...readRenderers,
  };
};

export const createReadToolDefinition: CwdFactory<
  ReadToolOptions,
  ToolDefinition<typeof readSchema, ReadToolDetails | undefined>
> = cwdFactory(createReadToolDefinitionImpl);

export const createReadTool: CwdFactory<ReadToolOptions, AgentTool<typeof readSchema>> = cwdFactory(
  (cwd, options) => wrapToolDefinition(createReadToolDefinitionImpl(cwd, options)),
);
