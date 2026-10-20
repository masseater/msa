import { expect, expectTypeOf, it } from "vite-plus/test";

import { createBashTool, createEditTool, createReadTool } from "../src/tools/index.ts";
import specUsageExtensions from "./spec-usage-extensions.ts";
import type specUsageNamesTypes from "./spec-usage-names.ts";
import specUsageSequences from "./spec-usage-sequences.ts";
import taskSequences from "./spec-usage-task-sequences.ts";

const {
  bashExtensions,
  chatExtension,
  followTask,
  paymentTask,
  planMode,
  promptExtensions,
  subagentExtension,
  subagentTools,
} = specUsageExtensions;
const { containerSequence, hostSequence, setupSequences } = specUsageSequences;

function examples(names: specUsageNamesTypes.SpecNames) {
  const tools = {
    bashTool: createBashTool(),
    editTool: createEditTool(),
    readTool: createReadTool(),
  };
  const extensions = {
    ...promptExtensions(names),
    ...bashExtensions(names, tools.bashTool),
    ...planMode(names),
    Chat: chatExtension(),
    Subagent: subagentExtension(names),
    SubagentTools: subagentTools(names),
  };
  const Payment = paymentTask(names);
  const sequences = {
    ...setupSequences(names, tools.readTool),
    ...containerSequence(names),
    ...hostSequence(names, tools, extensions),
    ...taskSequences(names, extensions.SubagentTools, followTask()),
  };
  return { Payment, sequences };
}

it("compiles the spec's usage examples", () => {
  expectTypeOf(examples).returns.toHaveProperty("sequences");
  expect(examples).toBeTypeOf("function");
});
