import { Function as Fn } from "effect";

import type agentSessionTypes from "../../core/agent-session.types.ts";
import path from "../path.ts";

type Session = agentSessionTypes.AgentSession;

const createShareTrailingEntries: {
  (parentId: string | null, timestamp: string): (session: Session) => object[];
  (session: Session, parentId: string | null, timestamp: string): object[];
} = Fn.dual(3, (session: Session, parentId: string | null, timestamp: string): object[] => [
  {
    customType: "msa.share",
    data: {
      systemPrompt: session.state.systemPrompt,
      tools: session.state.tools.map((tool) => ({
        description: tool.description,
        name: tool.name,
        parameters: tool.parameters,
      })),
    },
    id: path.randomUuid().slice(0, 8),
    parentId,
    timestamp,
    type: "custom",
  },
]);

const shareTrailingEntries = {
  createShareTrailingEntries,
};

export default shareTrailingEntries;
