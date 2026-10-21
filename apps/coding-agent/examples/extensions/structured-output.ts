import codingAgent from "@msa/coding-agent";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import { Effect } from "effect";
import { Type } from "typebox";

const { defineTool } = codingAgent;

const { Text } = tui;

interface StructuredOutputDetails {
  headline: string;
  summary: string;
  actionItems: string[];
}

const structuredOutputTool = defineTool({
  description:
    "Return a final structured answer. Use this as your last action when the user asks for structured output or a machine-readable summary.",
  execute: (_toolCallId, params) =>
    Effect.runPromise(
      Effect.succeed({
        content: [{ text: `Saved structured output: ${params.headline}`, type: "text" }],
        details: {
          actionItems: params.actionItems,
          headline: params.headline,
          summary: params.summary,
        } satisfies StructuredOutputDetails,
        terminate: true,
      }),
    ),
  label: "Structured Output",
  name: "structured_output",
  parameters: Type.Object({
    actionItems: Type.Array(Type.String(), { description: "Concrete next steps or key bullets" }),
    headline: Type.String({ description: "Short title for the result" }),
    summary: Type.String({ description: "One-paragraph summary" }),
  }),
  promptGuidelines: [
    "Use structured_output as your final action when the user asks for structured output, JSON-like output, or a machine-readable summary.",
    "After calling structured_output, do not emit another assistant response in the same turn.",
  ],
  promptSnippet: "Emit a final structured answer as a terminating tool result",
  renderResult(result, _options, theme) {
    const details = result.details as StructuredOutputDetails | undefined;
    if (details === undefined) {
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    }

    const lines = [
      theme.fg("toolTitle", theme.bold(details.headline)),
      theme.fg("text", details.summary),
      "",
      ...details.actionItems.map((item, index) => theme.fg("muted", `${index + 1}. ${item}`)),
    ];
    return new Text(lines.join("\n"), 0, 0);
  },
});

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerTool(structuredOutputTool);
}
