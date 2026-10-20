import ai from "@msa/ai";
import { type ExtensionAPI, defineTool } from "@msa/coding-agent";
import { Effect } from "effect";

const { Type } = ai;

const helloTool = defineTool({
  description: "A simple greeting tool",
  execute: (_toolCallId, params) =>
    Effect.runPromise(
      Effect.succeed({
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: { greeted: params.name },
      }),
    ),
  label: "Hello",
  name: "hello",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),
});

export default function (msa: ExtensionAPI) {
  msa.registerTool(helloTool);
}
