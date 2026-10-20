import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem } from "effect";
import { type Static, Type } from "typebox";

import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import {
  ToolFailure,
  fromMaybePromise,
  nonEmptyOr,
  pathOperations,
  platformRuntime,
  rethrowCause,
} from "../platform/index.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { writeRenderers } from "./renderers/write.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";

const writeSchema = Type.Object({
  content: Type.String({ description: "Content to write to the file" }),
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
});

export const writeToolSystemPromptContribution = {
  guidelines: ["Use write only for new files or complete rewrites."],
  snippet: "Create or overwrite files",
} as const;

export type WriteToolInput = Static<typeof writeSchema>;

export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  mkdir: (dir) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.makeDirectory(dir, { recursive: true }))),
    ),
  writeFile: (path, content) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.writeFileString(path, content))),
    ),
};

export interface WriteToolOptions {
  operations?: WriteOperations;
}

const writeUnderQueue = (
  ops: WriteOperations,
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
  options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, undefined> => {
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
      ctx?: ExtensionContext,
    ) => {
      const absolutePath = resolveToCwd(path, nonEmptyOr(ctx?.cwd, cwd));
      const dir = pathOperations.dirname(absolutePath);
      return withFileMutationQueue(absolutePath, () =>
        platformRuntime.runPromise(writeUnderQueue(ops, dir, absolutePath, content, path, signal)),
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

export const createWriteToolDefinition: CwdFactory<
  WriteToolOptions,
  ToolDefinition<typeof writeSchema, undefined>
> = cwdFactory(createWriteToolDefinitionImpl);

export const createWriteTool: CwdFactory<
  WriteToolOptions,
  agentTypes.AgentTool<typeof writeSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createWriteToolDefinitionImpl(cwd, options)));
