import { expect, expectTypeOf, it } from "vite-plus/test";

import { createBashTool, createEditTool, createReadTool } from "../src/tools/index.ts";
import {
  bashExtensions,
  chatExtension,
  followTask,
  paymentTask,
  planMode,
  promptExtensions,
  subagentExtension,
  subagentTools,
} from "./spec-usage-extensions.ts";
import type { SpecNames } from "./spec-usage-names.ts";
import {
  containerSequence,
  hostSequence,
  setupSequences,
  taskSequences,
} from "./spec-usage-sequences.ts";

function examples(names: SpecNames) {
  const tools = {
    readTool: createReadTool(),
    editTool: createEditTool(),
    bashTool: createBashTool(),
  };
  const extensions = {
    ...promptExtensions(names),
    ...bashExtensions(names, tools.bashTool),
    ...planMode(names),
    Subagent: subagentExtension(names),
    SubagentTools: subagentTools(names),
    Chat: chatExtension(),
  };
  const Payment = paymentTask(names);
  const sequences = {
    ...setupSequences(names, tools.readTool),
    ...containerSequence(names),
    ...hostSequence(names, tools, extensions),
    ...taskSequences(names, extensions.SubagentTools, followTask()),
  };
  return { sequences, Payment };
}

it("compiles the spec's usage examples", () => {
  expectTypeOf(examples).returns.toHaveProperty("sequences");
  expect(examples).toBeTypeOf("function");
});
