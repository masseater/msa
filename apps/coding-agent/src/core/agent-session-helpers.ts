import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type agentSessionTypes from "./agent-session.types.ts";
import compactionModule from "./compaction/index.ts";

const { estimateTokens } = compactionModule;

function parseSkillBlock(text: string): agentSessionTypes.ParsedSkillBlock | null {
  const match = text.match(
    /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/u,
  );
  if (match === null) return null;
  const [, name, location, content, userMessage] = match;
  if (name === undefined || location === undefined || content === undefined) return null;
  return {
    content,
    location,
    name,
    userMessage: userMessage?.trim() || undefined,
  };
}

function withoutDeletedHeaders(
  headers: compatTypes.ProviderHeaders | undefined,
): Record<string, string> | undefined {
  return headers === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null),
      );
}

function estimateMessagesTokens(messages: agentTypes.AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) {
    tokens += estimateTokens(message);
  }
  return tokens;
}

const agentSessionHelpers = { estimateMessagesTokens, parseSkillBlock, withoutDeletedHeaders };

export default agentSessionHelpers;
