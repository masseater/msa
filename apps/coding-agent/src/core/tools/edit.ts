import type agentTypes from "@msa/agent-core/index.types";
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
  type EditToolInput,
  editSchema,
  editToolSystemPromptContribution,
  prepareEditArguments,
  validateEditInput,
} from "./edit-input.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { type EditRenderState, editRenderers } from "./renderers/edit.ts";
import { type CwdFactory, cwdFactory, wrapToolDefinition } from "./tool-definition-wrapper.ts";

export type { EditOperations } from "./edit-apply.ts";
export { editToolSystemPromptContribution, type EditToolInput } from "./edit-input.ts";

export interface EditToolDetails {
  diff: string;
  patch: string;
  firstChangedLine?: number | undefined;
}

const defaultEditOperations: EditOperations = {
  access: (path) =>
    platformRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true, writable: true })),
      ),
    ),
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
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
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
    label: "edit",
    name: "edit",
    parameters: editSchema,
    prepareArguments: prepareEditArguments,
    promptGuidelines: [...editToolSystemPromptContribution.guidelines],
    promptSnippet: editToolSystemPromptContribution.snippet,
    renderShell: "self",
    ...editRenderers,
  };
};

export const createEditToolDefinition: CwdFactory<
  EditToolOptions,
  ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState>
> = cwdFactory(createEditToolDefinitionImpl);

export const createEditTool: CwdFactory<
  EditToolOptions,
  agentTypes.AgentTool<typeof editSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createEditToolDefinitionImpl(cwd, options)));
