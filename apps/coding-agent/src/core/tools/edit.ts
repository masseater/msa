import * as NodeServices from "@effect/platform-node/NodeServices";
import type agentTypes from "@msa/agent-core/index.types";
import { Effect, FileSystem, ManagedRuntime } from "effect";

import type extensionsTypesTypes from "../extensions/types.types.ts";
import platform from "../platform/index.ts";
import editApply from "./edit-apply.ts";
import type editApplyTypes from "./edit-apply.types.ts";
import editInput from "./edit-input.ts";
import type editInputTypes from "./edit-input.types.ts";
import type editTypes from "./edit.types.ts";
import fileMutationQueue from "./file-mutation-queue.ts";
import pathUtils from "./path-utils.ts";
import editModule from "./renderers/edit.ts";
import type editTypesModule from "./renderers/edit.types.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const nodeRuntime = ManagedRuntime.make(NodeServices.layer);

const { performEdit } = editApply;
const { editSchema, editToolSystemPromptContribution, prepareEditArguments, validateEditInput } =
  editInput;
const { fromPromise, nonEmptyOr, rethrowCause, unwrapForeign } = platform;
const { editRenderers } = editModule;
const { resolveToCwd } = pathUtils;
const { withFileMutationQueue } = fileMutationQueue;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const defaultEditOperations: editApplyTypes.EditOperations = {
  access: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.access(path, { readable: true, writable: true })),
      ),
    ),
  readFile: (path) =>
    nodeRuntime.runPromise(
      rethrowCause(
        FileSystem.FileSystem.use((fs) => fs.readFile(path)).pipe(
          Effect.map((bytes) => Buffer.from(bytes)),
        ),
      ),
    ),
  writeFile: (path, content) =>
    nodeRuntime.runPromise(
      rethrowCause(FileSystem.FileSystem.use((fs) => fs.writeFileString(path, content))),
    ),
};

const createEditToolDefinitionImpl = (
  cwd: string,
  options?: editTypes.EditToolOptions,
): extensionsTypesTypes.ToolDefinition<
  typeof editSchema,
  editTypes.EditToolDetails | undefined,
  editTypesModule.EditRenderState
> => {
  const ops = options?.operations ?? defaultEditOperations;
  return {
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    execute: (
      _toolCallId,
      input: editInputTypes.EditToolInput,
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: extensionsTypesTypes.ExtensionContext,
    ) =>
      nodeRuntime.runPromise(
        unwrapForeign(
          Effect.gen(function* () {
            const { path, edits } = yield* validateEditInput(input);
            const absolutePath = resolveToCwd(path, nonEmptyOr(ctx?.cwd, cwd));
            return yield* fromPromise(() =>
              withFileMutationQueue(absolutePath, () =>
                nodeRuntime.runPromise(
                  unwrapForeign(performEdit({ absolutePath, edits, ops, path, signal })),
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

const createEditToolDefinition: toolDefinitionWrapperTypes.CwdFactory<
  editTypes.EditToolOptions,
  extensionsTypesTypes.ToolDefinition<
    typeof editSchema,
    editTypes.EditToolDetails | undefined,
    editTypesModule.EditRenderState
  >
> = cwdFactory(createEditToolDefinitionImpl);

const createEditTool: toolDefinitionWrapperTypes.CwdFactory<
  editTypes.EditToolOptions,
  agentTypes.AgentTool<typeof editSchema>
> = cwdFactory((cwd, options) => wrapToolDefinition(createEditToolDefinitionImpl(cwd, options)));

const edit = {
  createEditTool,
  createEditToolDefinition,
  editToolSystemPromptContribution: editInput.editToolSystemPromptContribution,
};

export default edit;
