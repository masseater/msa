import * as NodeServices from "@effect/platform-node/NodeServices";
import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import fileMutationQueue from "./file-mutation-queue.ts";
import pathUtils from "./path-utils.ts";
import writeModule from "./renderers/write.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";
import type writeTypes from "./write.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { ToolFailure, fromMaybePromise, nonEmptyOr, pathOperations, rethrowCause } = platform;
const { resolveToCwd } = pathUtils;
const { withFileMutationQueue } = fileMutationQueue;
const { writeRenderers } = writeModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const writeSchema = Type.Object({
  content: Type.String({ description: "Content to write to the file" }),
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
});

const writeToolSystemPromptContribution = {
  guidelines: ["Use write only for new files or complete rewrites."],
  snippet: "Create or overwrite files",
} as const;

const defaultWriteOperations: writeTypes.WriteOperations = {
  mkdir: (dir) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.makeDirectory(dir, { recursive: true }))),
    ),
  writeFile: (path, content) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.writeFileString(path, content))),
    ),
};

const writeUnderQueue = (
  ops: writeTypes.WriteOperations,
  dir: string,
  absolutePath: string,
  content: string,
  path: string,
  signal: AbortSignal | undefined,
) => {
  const throwIfAborted = Effect.suspend(() =>
    signal?.aborted === true
      ? Effect.fail(new ToolFailure({ message: "Operation aborted" }))
      : Effect.void,
  );
  return Effect.gen(function* () {
    yield* throwIfAborted;
    yield* fromMaybePromise(() => ops.mkdir(dir));
    yield* throwIfAborted;
    yield* fromMaybePromise(() => ops.writeFile(absolutePath, content));
    yield* throwIfAborted;
    return {
      content: [{ text: `Successfully wrote to ${path}`, type: "text" as const }],
      details: undefined,
    };
  });
};

const createWriteToolDefinitionImpl = (
  cwd: string,
  options?: writeTypes.WriteToolOptions,
): extensionsTypesTypes.ToolDefinition<typeof writeSchema, undefined> => {
  const ops = options?.operations ?? defaultWriteOperations;
  return {
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    execute: (
      _toolCallId,
      { path, content }: { path: string; content: string },
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: extensionsTypesTypes.ExtensionContext,
    ) => {
      const absolutePath = resolveToCwd(path, nonEmptyOr(ctx?.cwd, cwd));
      const dir = pathOperations.dirname(absolutePath);
      return withFileMutationQueue(absolutePath, () =>
        nodeRuntime.runPromise(writeUnderQueue(ops, dir, absolutePath, content, path, signal)),
      );
    },
    label: "write",
    name: "write",
    parameters: writeSchema,
    promptGuidelines: [...writeToolSystemPromptContribution.guidelines],
    promptSnippet: writeToolSystemPromptContribution.snippet,
    ...writeRenderers,
  };
};

const createWriteToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  writeTypes.WriteToolOptions,
  extensionsTypesTypes.ToolDefinition<typeof writeSchema, undefined>
> = cwdFactory(createWriteToolDefinitionImpl);

const createWriteTool: toolDefinitionWrapperTypes.CwdFactory<
  writeTypes.WriteToolOptions,
  agentTypes.AgentTool<typeof writeSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createWriteToolDefinitionImpl(cwd, options)));

const write = {
  createWriteTool,
  createWriteToolDefinition,
  writeSchema,
  writeToolSystemPromptContribution,
};

export default write;
