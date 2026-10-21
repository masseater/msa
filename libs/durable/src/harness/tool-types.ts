import documents from "../documents.ts";
import type toolTypesModule from "./tool-types.types.ts";

const { defineDocFamily } = documents;

const MADE_NESTED_CALLS = "msa.tool.madeNestedCalls";

const TOOL_TASK_NAME = "msa.tool";

const NestedCallDoc = defineDocFamily<toolTypesModule.NestedCallState, null>({
  family: true,
  initial: () => ({}),
  kind: "msa.tool.nested-call",
  scope: "task",
  version: 1,
});

const COMPLETED: toolTypesModule.Ending = { status: "completed" };

const toolTypes = {
  COMPLETED,
  MADE_NESTED_CALLS,
  NestedCallDoc,
  TOOL_TASK_NAME,
};

export default toolTypes;
