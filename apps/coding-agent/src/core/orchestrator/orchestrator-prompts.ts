import { Function as Fn } from "effect";

import type { SessionNode, SessionNodeWithDependencies } from "./graph.ts";

const REPORT_LIMIT = 4000;

export function truncate(text: string): string {
  const limit = REPORT_LIMIT;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars; use read_session for the full report]`;
}

function describeNode(node: SessionNodeWithDependencies): string {
  const dependsOn = node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "-";
  return `${node.id} [${node.kind}, round ${node.round}] ${node.status} — ${node.title} (model ${node.model}, thinking ${node.thinkingLevel}; depends on ${dependsOn})`;
}

export function formatSessionList(nodes: readonly SessionNodeWithDependencies[]): string {
  if (nodes.length === 0) return "No sessions.";
  return nodes.map(describeNode).join("\n");
}

const reviewPromptImpl = (round: number, nodes: readonly SessionNodeWithDependencies[]): string => {
  const reports = nodes
    .filter((node) => node.kind === "task" && node.round === round)
    .map(
      (node) =>
        `<session id="${node.id}" title="${node.title}" status="${node.status}">\n${node.report ?? "(no report)"}\n</session>`,
    );
  return [
    `You are the closing reviewer of round ${round} of an orchestrated project. Every session of the round has finished, and nothing else runs while you work.`,
    "Step back and review the work as a whole, not session by session: check the results against each other and against the original intent, read the code and files they changed, and find gaps, conflicts, duplicated work, and wrong assumptions.",
    "Then redesign: say what should change in the overall approach and lay out the remaining work as independent sessions with their dependencies, so the orchestrator can start the next round. If nothing is left, say so.",
    "",
    "<dependency-graph>",
    formatSessionList(nodes),
    "</dependency-graph>",
    "",
    ...reports,
  ].join("\n");
};

export const reviewPrompt: {
  (nodes: readonly SessionNodeWithDependencies[]): (round: number) => string;
  (round: number, nodes: readonly SessionNodeWithDependencies[]): string;
} = Fn.dual(2, reviewPromptImpl);

const taskPromptImpl = (
  node: SessionNode,
  dependencies: readonly SessionNodeWithDependencies[],
): string => {
  if (dependencies.length === 0) return node.prompt;
  const reports = dependencies.map(
    (dependency) =>
      `<session id="${dependency.id}" title="${dependency.title}">\n${dependency.report ?? "(no report)"}\n</session>`,
  );
  return [node.prompt, "", "Reports of the sessions this task depends on:", "", ...reports].join(
    "\n",
  );
};

export const taskPrompt: {
  (dependencies: readonly SessionNodeWithDependencies[]): (node: SessionNode) => string;
  (node: SessionNode, dependencies: readonly SessionNodeWithDependencies[]): string;
} = Fn.dual(2, taskPromptImpl);
