import { Effect } from "effect";

import { Type } from "@msa/ai";
import { defineTool, type ExtensionAPI } from "@msa/coding-agent";

const helloTool = defineTool({
  name: "hello",
  label: "Hello",
  description: "A simple greeting tool",
  parameters: Type.Object({
    name: Type.String({ description: "Name to greet" }),
  }),

  execute: (_toolCallId, params) =>
    Effect.runPromise(
      Effect.succeed({
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: { greeted: params.name },
      }),
    ),
});

export default function (msa: ExtensionAPI) {
  msa.registerTool(helloTool);
}
