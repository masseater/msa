import type { AgentTool } from "@msa/agent-core";
import { Effect, FileSystem } from "effect";
import { type Static, Type } from "typebox";

import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import {
  fromMaybePromise,
  nonEmptyOr,
  pathOperations,
  platformRuntime,
  rethrowCause,
  ToolFailure,
} from "../platform/index.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { writeRenderers } from "./renderers/write.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";

const writeSchema = Type.Object({
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export const writeToolSystemPromptContribution = {
  snippet: "Create or overwrite files",
  guidelines: ["Use write only for new files or complete rewrites."],
} as const;

export type WriteToolInput = Static<typeof writeSchema>;

export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  writeFile: (path, content) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.writeFileString(path, content))),
    ),
  mkdir: (dir) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.makeDirectory(dir, { recursive: true }))),
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
      content: [{ type: "text" as const, text: `Successfully wrote to ${path}` }],
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
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptSnippet: writeToolSystemPromptContribution.snippet,
    promptGuidelines: [...writeToolSystemPromptContribution.guidelines],
    parameters: writeSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
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
    ...writeRenderers,
  };
};

export const createWriteToolDefinition: CwdFactory<
  WriteToolOptions,
  ToolDefinition<typeof writeSchema, undefined>
> = cwdFactory(createWriteToolDefinitionImpl);

export const createWriteTool: CwdFactory<
  WriteToolOptions,
  AgentTool<typeof writeSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createWriteToolDefinitionImpl(cwd, options)));
