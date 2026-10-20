import testing from "@msa/testing";

import type sessionManagerTypes from "../src/core/session-manager.types.ts";

const { currentDate, currentTimeMillis } = testing;

function userMessage(
  id: string,
  parentId: string | null,
  content: string,
): sessionManagerTypes.SessionMessageEntry {
  return {
    id,
    message: { content, role: "user", timestamp: currentTimeMillis() },
    parentId,
    timestamp: currentDate().toISOString(),
    type: "message" as const,
  };
}

function assistantMessage(
  id: string,
  parentId: string | null,
  text: string,
): sessionManagerTypes.SessionMessageEntry {
  return {
    id,
    message: {
      api: "anthropic-messages" as const,
      content: [{ text, type: "text" as const }],
      model: "claude-sonnet-4",
      provider: "anthropic-api",
      role: "assistant",
      stopReason: "stop",
      timestamp: currentTimeMillis(),
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    parentId,
    timestamp: currentDate().toISOString(),
    type: "message" as const,
  };
}

function buildTree(
  entries: Array<sessionManagerTypes.SessionEntry>,
): sessionManagerTypes.SessionTreeNode[] {
  if (entries.length === 0) return [];

  const nodes: sessionManagerTypes.SessionTreeNode[] = entries.map((entry) => ({
    children: [],
    entry,
  }));

  const byId = new Map<string, sessionManagerTypes.SessionTreeNode>();
  for (const node of nodes) {
    byId.set(node.entry.id, node);
  }

  const roots: sessionManagerTypes.SessionTreeNode[] = [];
  for (const node of nodes) {
    if (node.entry.parentId === null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.entry.parentId);
      if (parent !== undefined) {
        parent.children.push(node);
      }
    }
  }
  return roots;
}

const treeSelectorSupport = {
  assistantMessage,
  buildTree,
  userMessage,
};

export default treeSelectorSupport;
