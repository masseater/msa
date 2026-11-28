import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

function textOf(result: agentTypes.AgentToolResult<unknown>): string {
  return (result.content ?? [])
    .filter((block): block is aiTypes.TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const toolResultText = {
  textOf,
};

export default toolResultText;
