import * as NodeServices from "@effect/platform-node/NodeServices";
import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import mime from "../../utils/mime.ts";
import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import pathUtils from "./path-utils.ts";
import readContent from "./read-content.ts";
import type readContentTypes from "./read-content.types.ts";
import readModule from "./renderers/read.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const {
  readDescription,
  readImageContent,
  readOutputSchema,
  readSchema,
  readTextContent,
  readToolSystemPromptContribution,
  toReadOutput,
} = readContent;
const { abortedBy, fromPromise, nonEmptyOr, rethrowCause, unwrapForeign } = platform;
const { detectSupportedImageMimeTypeFromFile } = mime;
const { resolveReadPathAsync } = pathUtils;
const { readRenderers } = readModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const defaultReadOperations: readContentTypes.ReadOperations = {
  access: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true }))),
    ),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
  readFile: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
          Effect.map((bytes) => Buffer.from(bytes)),
        ),
      ),
    ),
};

interface ReadRequest {
  ops: readContentTypes.ReadOperations;
  options: readContentTypes.ReadToolOptions | undefined;
  cwd: string;
  path: string;
  offset: number | undefined;
  limit: number | undefined;
  ctx: extensionsTypesTypes.ExtensionContext | undefined;
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
    return { content, details: undefined as readContentTypes.ReadToolDetails | undefined };
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
  options?: readContentTypes.ReadToolOptions,
): extensionsTypesTypes.ToolDefinition<
  typeof readSchema,
  readContentTypes.ReadToolDetails | undefined
> => {
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
      ctx?: extensionsTypesTypes.ExtensionContext,
    ) =>
      nodeRuntime.runPromise(
        unwrapForeign(
          readFileTool({ ctx, cwd, limit, offset, ops, options, path }).pipe(
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

const createReadToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  readContentTypes.ReadToolOptions,
  extensionsTypesTypes.ToolDefinition<
    typeof readSchema,
    readContentTypes.ReadToolDetails | undefined
  >
> = cwdFactory(createReadToolDefinitionImpl);

const createReadTool: toolDefinitionWrapperTypes.CwdFactory<
  readContentTypes.ReadToolOptions,
  agentTypes.AgentTool<typeof readSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createReadToolDefinitionImpl(cwd, options)));

const read = {
  createReadTool,
  createReadToolDefinition,
  readToolSystemPromptContribution: readContent.readToolSystemPromptContribution,
};

export default read;
