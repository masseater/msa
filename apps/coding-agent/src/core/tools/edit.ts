import type agentTypes from "@msa/agent-core/index.types";

import platform from "../platform/index.ts";
import editFileModule from "./edit-file.ts";
import editInput from "./edit-input.ts";
import type editTypes from "./edit.types.ts";
import editModule from "./renderers/edit.ts";
import toolDefinitionWrapper from "./tool-definition-wrapper.ts";
import type toolDefinitionWrapperTypes from "./tool-definition-wrapper.types.ts";

const { defaultEditOperations, editFile } = editFileModule;
const { editSchema, editToolSystemPromptContribution, prepareEditArguments } = editInput;
const { nonEmptyOr } = platform;
const { editRenderers } = editModule;
const { cwdFactory, wrapToolDefinition } = toolDefinitionWrapper;

const createEditToolDefinitionImpl = (
  cwd: string,
  options?: editTypes.EditToolOptions,
): editTypes.EditToolDefinition => {
  const ops = options?.operations ?? defaultEditOperations;
  return {
    constrainedSampling: { strict: "prefer", type: "json_schema" },
    description:
      "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
    execute: (
      _toolCallId,
      input: editTypes.EditToolInput,
      signal?: AbortSignal,
      _onUpdate?,
      ctx?: editTypes.EditToolContext,
    ) => editFile({ cwd: nonEmptyOr(ctx?.cwd, cwd), input, ops, signal }),
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
  editTypes.EditToolDefinition
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
