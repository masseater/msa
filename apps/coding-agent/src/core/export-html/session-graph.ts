import type aiTypes from "@msa/ai/index.types";

import type sessionManagerTypes from "../session-manager.types.ts";
import type exportTypesTypes from "./export-types.ts";
import type sessionViewTypes from "./session-view.types.ts";

type Entry = sessionViewTypes.Entry;

type TreeNode = sessionManagerTypes.SessionTreeNode;

const toolCallsOf = (entries: readonly Entry[]): ReadonlyMap<string, aiTypes.ToolCall> =>
  new Map(
    entries.flatMap((entry) =>
      entry.type === "message" && entry.message.role === "assistant"
        ? entry.message.content.flatMap((block) =>
            block.type === "toolCall" ? [[block.id, block] as const] : [],
          )
        : [],
    ),
  );

const toolResultsOf = (
  entries: readonly Entry[],
): ReadonlyMap<string, sessionViewTypes.ToolResult> =>
  new Map(
    entries.flatMap((entry) =>
      entry.type === "message" && entry.message.role === "toolResult"
        ? [[entry.message.toolCallId, entry.message] as const]
        : [],
    ),
  );

const newestLeavesOf = (roots: readonly TreeNode[]): ReadonlyMap<string, string> => {
  const leaves = new Map<string, string>();
  const order: TreeNode[] = [];
  const stack = [...roots];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    order.push(node);
    stack.push(...node.children);
  }
  for (const node of order.toReversed()) {
    const last = node.children.at(-1);
    leaves.set(
      node.entry.id,
      last === undefined ? node.entry.id : (leaves.get(last.entry.id) ?? last.entry.id),
    );
  }
  return leaves;
};

const pathTo = (byId: ReadonlyMap<string, Entry>, id: string): readonly string[] => {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current =
      current.parentId === null || current.parentId === current.id
        ? undefined
        : byId.get(current.parentId);
  }
  return path;
};

const defaultLeafOf = (
  sessionData: exportTypesTypes.SessionData,
  byId: ReadonlyMap<string, Entry>,
): string | undefined =>
  sessionData.leafId !== null && byId.has(sessionData.leafId)
    ? sessionData.leafId
    : sessionData.entries.at(-1)?.id;

const sessionGraph = (sessionData: exportTypesTypes.SessionData): sessionViewTypes.SessionGraph => {
  const { entries } = sessionData;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const newestLeaf = newestLeavesOf(sessionData.tree);
  const defaultLeaf = defaultLeafOf(sessionData, byId);
  const views = [
    ...new Set([...(defaultLeaf === undefined ? [] : [defaultLeaf]), ...newestLeaf.values()]),
  ];
  return {
    byId,
    defaultLeaf,
    entries,
    newestLeaf,
    pathTo: (id) => pathTo(byId, id),
    toolCalls: toolCallsOf(entries),
    toolResults: toolResultsOf(entries),
    viewIndex: new Map(views.map((view, index) => [view, index])),
    views,
  };
};

const pathClassesOf = (graph: sessionViewTypes.SessionGraph): ReadonlyMap<string, string> => {
  const classes = new Map<string, string[]>();
  graph.views.forEach((view, index) => {
    for (const id of graph.pathTo(view)) classes.set(id, [...(classes.get(id) ?? []), `v${index}`]);
  });
  return new Map([...classes].map(([id, names]) => [id, names.join(" ")]));
};

const entryRefs = (graph: sessionViewTypes.SessionGraph): sessionViewTypes.EntryRefs => {
  const indexes = new Map(graph.entries.map(({ id }, index) => [id, index]));
  const paths = pathClassesOf(graph);
  return {
    anchorOf: (id) => `entry-${id}`,
    indexOf: (id) => indexes.get(id) ?? -1,
    isNested: (id) => {
      const entry = graph.byId.get(id);
      return (
        entry?.type === "message" &&
        entry.message.role === "toolResult" &&
        graph.toolCalls.has(entry.message.toolCallId)
      );
    },
    leafOf: (id) => graph.viewIndex.get(graph.newestLeaf.get(id) ?? id) ?? 0,
    pathClassesOf: (id) => paths.get(id) ?? "",
  };
};

const sessionGraphModule = { entryRefs, sessionGraph };

export default sessionGraphModule;
