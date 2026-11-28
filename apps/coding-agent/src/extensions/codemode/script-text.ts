import type agentTypes from "@msa/agent-core/index.types";

import toolResultText from "../../core/tool-result-text.ts";

const { textOf } = toolResultText;

const ARGS_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS = 500;

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

function previewArgs(args: unknown): string {
  if (args === undefined) return "";
  try {
    return truncateText(JSON.stringify(args) ?? "", ARGS_PREVIEW_CHARS);
  } catch {
    return "";
  }
}

function toScriptValue(
  tool: agentTypes.AgentTool<any>,
  outcome: agentTypes.AgentToolCallOutcome,
): unknown {
  const { result } = outcome;
  if (tool.outputSchema !== undefined && result.structuredContent !== undefined)
    return result.structuredContent;
  const text = textOf(result);
  if (outcome.isError) throw new Error(text || `Tool "${tool.name}" failed`);
  return text;
}

const scriptText = { ERROR_PREVIEW_CHARS, previewArgs, textOf, toScriptValue, truncateText };

export default scriptText;
