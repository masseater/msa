import ai from "@msa/ai";
import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

const { defineTool } = codingAgent;

const { Type } = ai;

const helloTool = defineTool({
  description: "A simple greeting tool",
  execute: (_toolCallId, params) =>
    Effect.runPromise(
      Effect.succeed({
        content: [{ text: `Hello, ${params.name}!`, type: "text" }],
        details: { greeted: params.name },
      }),
    ),
  label: "Hello",
  name: "hello",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),
});

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerTool(helloTool);
}
