import type { AgentTool } from "@msa/agent-core";
import { Effect, FileSystem } from "effect";

import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import {
  fromPromise,
  nonEmptyOr,
  platformRuntime,
  rethrowCause,
  unwrapForeign,
} from "../platform/index.ts";
import { type EditOperations, performEdit } from "./edit-apply.ts";
import {
  editSchema,
  type EditToolInput,
  editToolSystemPromptContribution,
  prepareEditArguments,
  validateEditInput,
} from "./edit-input.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { type EditRenderState, editRenderers } from "./renderers/edit.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";

export { type EditToolInput, editToolSystemPromptContribution } from "./edit-input.ts";

export interface EditToolDetails {
  diff: string;
  patch: string;
  firstChangedLine?: number | undefined;
}

const defaultEditOperations: EditOperations = {
  readFile: (path) =>
    platformRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
          Effect.map((bytes) => Buffer.from(bytes)),
        ),
      ),
    ),
  writeFile: (path, content) =>
    platformRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.writeFileString(path, content))),
    ),
  access: (path) =>
    platformRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true, writable: true })),
      ),
    ),
};

export interface EditToolOptions {
  operations?: EditOperations;
}

const createEditToolDefinitionImpl = (
  cwd: string,
  options?: EditToolOptions,
): ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState> => {
  const ops = options?.operations ?? defaultEditOperations;
  return {
    name: "edit",
    label: "edit",
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    promptSnippet: editToolSystemPromptContribution.snippet,
    promptGuidelines: [...editToolSystemPromptContribution.guidelines],
    parameters: editSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
    renderShell: "self",
    prepareArguments: prepareEditArguments,
    execute: (
      _toolCallId,
      input: EditToolInput,
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: ExtensionContext,
    ) =>
      platformRuntime.runPromise(
        unwrapForeign(
          Effect.gen(function* () {
            const { path, edits } = yield* validateEditInput(input);
            const absolutePath = resolveToCwd(path, nonEmptyOr(ctx?.cwd, cwd));
            return yield* fromPromise(() =>
              withFileMutationQueue(absolutePath, () =>
                platformRuntime.runPromise(
                  unwrapForeign(performEdit({ ops, path, absolutePath, edits, signal })),
                ),
              ),
            );
          }),
        ),
      ),
    ...editRenderers,
  };
};

export const createEditToolDefinition: CwdFactory<
  EditToolOptions,
  ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState>
> = cwdFactory(createEditToolDefinitionImpl);

export const createEditTool: CwdFactory<EditToolOptions, AgentTool<typeof editSchema>> = cwdFactory(
  (cwd, options) => wrapToolDefinition(createEditToolDefinitionImpl(cwd, options)),
);
