import type agentTypes from "@msa/agent-core/index.types";
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
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolOptions,
  readDescription,
  readImageContent,
  readOutputSchema,
  readSchema,
  readTextContent,
  readToolSystemPromptContribution,
  toReadOutput,
} from "./read-content.ts";
import { readRenderers } from "./renderers/read.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";

export {
  readToolSystemPromptContribution,
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  type ReadToolOptions,
  type ReadToolOutput,
} from "./read-content.ts";

const defaultReadOperations: ReadOperations = {
  access: (path) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true }))),
    ),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
  readFile: (path) =>
    platformRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
          Effect.map((bytes) => Buffer.from(bytes)),
        ),
      ),
    ),
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
      absolutePath,
      autoResizeImages: options?.autoResizeImages ?? true,
      mimeType,
      model: ctx?.model,
      ops,
      resizeOptions: ctx?.model?.inputLimits?.images?.resize ?? options?.resizeOptions,
    });
    return { content, details: undefined as ReadToolDetails | undefined };
  }
  const buffer = yield* fromPromise(() => ops.readFile(absolutePath));
  return yield* readTextContent({
    buffer,
    limit: request.limit,
    offset: request.offset,
    path: request.path,
  });
});

const createReadToolDefinitionImpl = (
  cwd: string,
  options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails | undefined> => {
  const ops = options?.operations ?? defaultReadOperations;
  return {
    annotations: { readOnlyHint: true },
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description: readDescription,
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
    label: "read",
    name: "read",
    outputSchema: readOutputSchema,
    parameters: readSchema,
    promptGuidelines: [...readToolSystemPromptContribution.guidelines],
    promptSnippet: readToolSystemPromptContribution.snippet,
    ...readRenderers,
  };
};

export const createReadToolDefinition: CwdFactory<
  ReadToolOptions,
  ToolDefinition<typeof readSchema, ReadToolDetails | undefined>
> = cwdFactory(createReadToolDefinitionImpl);

export const createReadTool: CwdFactory<
  ReadToolOptions,
  agentTypes.AgentTool<typeof readSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createReadToolDefinitionImpl(cwd, options)));
