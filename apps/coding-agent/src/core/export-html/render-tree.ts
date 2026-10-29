import type treeListInternalTypes from "../../modes/interactive/components/tree-list-internal.types.ts";
import TreeList from "../../modes/interactive/components/tree-list.ts";
import type treeSelectorTypes from "../../modes/interactive/components/tree-selector.types.ts";
import htmlModule from "../../utils/html.ts";
import agentSessionHelpers from "../agent-session-helpers.ts";
import toolCallSummaryModule from "../tools/tool-call-summary.ts";
import entryText from "./entry-text.ts";
import type exportTypesTypes from "./export-types.ts";
import type sessionViewTypes from "./session-view.types.ts";

const { escapeXml } = htmlModule;
const { oneLine, shortenHomePath, textOf, truncate } = entryText;
const { parseSkillBlock } = agentSessionHelpers;
const { toolCallSummary } = toolCallSummaryModule;

type Entry = sessionViewTypes.Entry;

type Graph = sessionViewTypes.SessionGraph;

type FlatNode = treeListInternalTypes.FlatNode;

const span = (className: string, html: string): string =>
  `<span class="${className}">${html}</span>`;

const short = (text: string): string => escapeXml(truncate(oneLine(text)));

const userLabel = (text: string): string => {
  const skill = parseSkillBlock(text);
  if (skill === null) return `${span("tree-role-user", "user:")} ${short(text)}`;
  const user =
    skill.userMessage === undefined
      ? ""
      : ` · ${span("tree-role-user", "user:")} ${short(skill.userMessage)}`;
  return `${span("tree-role-skill", "skill:")} ${escapeXml(skill.name)}${user}`;
};

const assistantLabel = (
  message: Extract<sessionViewTypes.MessageEntry["message"], { role: "assistant" }>,
): string => {
  const role = span("tree-role-assistant", "assistant:");
  const text = truncate(oneLine(textOf(message.content)));
  if (text !== "") return `${role} ${escapeXml(text)}`;
  if (message.stopReason === "aborted") return `${role} ${span("tree-muted", "(aborted)")}`;
  if (message.errorMessage !== undefined && message.errorMessage !== "") {
    return `${role} ${span("tree-error", escapeXml(truncate(message.errorMessage)))}`;
  }
  return `${role} ${span("tree-muted", "(no text)")}`;
};

const messageLabel = (graph: Graph, message: sessionViewTypes.MessageEntry["message"]): string => {
  switch (message.role) {
    case "user":
      return userLabel(textOf(message.content));
    case "assistant":
      return assistantLabel(message);
    case "toolResult": {
      const call = graph.toolCalls.get(message.toolCallId);
      const summary =
        call === undefined
          ? `[${message.toolName || "tool"}]`
          : toolCallSummary(call.name, call.arguments, shortenHomePath);
      return span("tree-role-tool", escapeXml(summary));
    }
    case "bashExecution":
      return `${span("tree-role-tool", "[bash]:")} ${short(message.command)}`;
    default:
      return span("tree-muted", `[${escapeXml(message.role)}]`);
  }
};

const muted = (text: string): string => span("tree-muted", escapeXml(text));

const entryLabel = (graph: Graph, entry: Entry): string => {
  switch (entry.type) {
    case "message":
      return messageLabel(graph, entry.message);
    case "compaction":
      return span(
        "tree-compaction",
        `[compaction: ${Math.round(entry.tokensBefore / 1000)}k tokens]`,
      );
    case "branch_summary":
      return `${span("tree-branch-summary", "[branch summary]:")} ${short(entry.summary)}`;
    case "custom_message": {
      const content = typeof entry.content === "string" ? entry.content : textOf(entry.content);
      return `${span("tree-custom-message", `[${escapeXml(entry.customType)}]:`)} ${short(content)}`;
    }
    case "model_change":
      return muted(`[model: ${entry.modelId}]`);
    case "thinking_level_change":
      return muted(`[thinking: ${entry.thinkingLevel}]`);
    case "context_edit":
      return muted(
        `[context ${entry.replacement === null ? "omit" : "replace"}: ${entry.targetId}]`,
      );
    default:
      return muted(`[${entry.type}]`);
  }
};

const prefixChar = (node: FlatNode, position: number, connectorLevel: number): string => {
  const level = Math.floor(position / 3);
  const column = position % 3;
  const gutter = node.gutters.find((candidate) => candidate.position === level);
  if (gutter !== undefined) return column === 0 && gutter.show ? "│" : " ";
  if (level !== connectorLevel) return " ";
  if (column === 0) return node.isLast ? "└" : "├";
  return column === 1 ? "─" : " ";
};

const prefixOf = (node: FlatNode, multipleRoots: boolean): string => {
  const displayIndent = multipleRoots ? Math.max(0, node.indent - 1) : node.indent;
  const connectorLevel = node.showConnector && !node.isVirtualRootChild ? displayIndent - 1 : -1;
  return Array.from({ length: displayIndent * 3 }, (_, position) =>
    prefixChar(node, position, connectorLevel),
  ).join("");
};

const nodeHtml = (
  graph: Graph,
  refs: sessionViewTypes.EntryRefs,
  node: FlatNode,
  multipleRoots: boolean,
): string => {
  const { entry, label } = node.node;
  const labelHtml =
    label === undefined || label === "" ? "" : `${span("tree-label", `[${escapeXml(label)}]`)} `;
  const index = refs.indexOf(entry.id);
  return `<a class="tree-node t${index} ${refs.pathClassesOf(entry.id)}" href="#${escapeXml(refs.anchorOf(entry.id))}" data-e="${index}">${span("tree-prefix", prefixOf(node, multipleRoots))}${span("tree-marker", "")}${span("tree-content", labelHtml + entryLabel(graph, entry))}</a>`;
};

interface Tree {
  readonly nodes: string;
  readonly status: string;
}

const renderTree = (
  sessionData: exportTypesTypes.SessionData,
  graph: Graph,
  refs: sessionViewTypes.EntryRefs,
  mode: treeSelectorTypes.FilterMode,
): Tree => {
  const list = new TreeList(
    sessionData.tree,
    graph.defaultLeaf ?? null,
    Number.MAX_SAFE_INTEGER,
    undefined,
    mode,
  );
  const nodes = list.filteredNodes
    .map((node) => nodeHtml(graph, refs, node, list.multipleRoots))
    .join("");
  return {
    nodes: `<div class="tree" data-filter="${mode}">${nodes}</div>`,
    status: `<span class="tree" data-filter="${mode}">${list.filteredNodes.length} / ${list.flatNodes.length} entries</span>`,
  };
};

const FILTER_MODES: readonly treeSelectorTypes.FilterMode[] = [
  "default",
  "no-tools",
  "user-only",
  "labeled-only",
  "all",
];

const renderTrees = (
  sessionData: exportTypesTypes.SessionData,
  graph: Graph,
  refs: sessionViewTypes.EntryRefs,
): Tree => {
  const trees = FILTER_MODES.map((mode) => renderTree(sessionData, graph, refs, mode));
  return {
    nodes: trees.map(({ nodes }) => nodes).join(""),
    status: trees.map(({ status }) => status).join(""),
  };
};

const renderTreeModule = { FILTER_MODES, renderTrees };

export default renderTreeModule;
