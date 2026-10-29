import type aiTypes from "@msa/ai/index.types";

import htmlModule from "../../utils/html.ts";
import agentSessionHelpers from "../agent-session-helpers.ts";
import entryText from "./entry-text.ts";
import type exportTypesTypes from "./export-types.ts";
import markdown from "./markdown.ts";
import renderOutput from "./render-output.ts";
import renderToolCallModule from "./render-tool-call.ts";
import type sessionViewTypes from "./session-view.types.ts";

const { escapeXml } = htmlModule;
const { textOf } = entryText;
const { parseSkillBlock } = agentSessionHelpers;
const { renderMarkdown } = markdown;
const { formatOutput, images, imagesOf } = renderOutput;
const { renderToolCall } = renderToolCallModule;

type Entry = sessionViewTypes.Entry;

interface EntryContext {
  readonly graph: sessionViewTypes.SessionGraph;
  readonly refs: sessionViewTypes.EntryRefs;
  readonly renderedTools: ReadonlyMap<string, exportTypesTypes.RenderedToolHtml>;
  readonly resultEntries: ReadonlyMap<string, string>;
  readonly timeOf: (id: string) => string | undefined;
}

const LINK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

const attributes = (context: EntryContext, id: string): string =>
  `id="${escapeXml(context.refs.anchorOf(id))}" data-e="${context.refs.indexOf(id)}" data-v="${context.refs.leafOf(id)}"`;

const opening = (context: EntryContext, entry: Entry, classes: string, tag = "div"): string =>
  `<${tag} class="entry ${classes} ${context.refs.pathClassesOf(entry.id)}" ${attributes(context, entry.id)}>`;

const timestamp = (context: EntryContext, id: string): string => {
  const time = context.timeOf(id);
  return time === undefined ? "" : `<div class="message-timestamp">${escapeXml(time)}</div>`;
};

const linkButton = (context: EntryContext, id: string): string =>
  `<a class="copy-link-btn" href="#${escapeXml(context.refs.anchorOf(id))}" title="Link to this message">${LINK_ICON}</a>`;

const decorations = (context: EntryContext, id: string): string =>
  `${linkButton(context, id)}${timestamp(context, id)}`;

const messageImages = (content: aiTypes.UserMessage["content"]): string =>
  images(imagesOf(content), "message-images", "message-image");

const userBody = (content: aiTypes.UserMessage["content"], text: string): string =>
  `${messageImages(content)}${text.trim() === "" ? "" : `<div class="markdown-content">${renderMarkdown(text)}</div>`}`;

const renderUser = (context: EntryContext, entry: Entry, message: aiTypes.UserMessage): string => {
  const text = textOf(message.content, "\n");
  const skill = parseSkillBlock(text);
  if (skill === null) {
    return `${opening(context, entry, "user-message")}${decorations(context, entry.id)}${userBody(message.content, text)}</div>`;
  }
  const invocation = `<details class="skill-invocation follows-tools"><summary><div class="skill-invocation-label">[skill] ${escapeXml(skill.name)}</div><div class="skill-invocation-collapsed">${escapeXml(skill.name)}</div></summary><div class="skill-invocation-content markdown-content">${renderMarkdown(skill.content)}</div></details>`;
  const user = userBody(message.content, skill.userMessage ?? "");
  const userBlock = user === "" ? "" : `<div class="user-message">${user}</div>`;
  return `${opening(context, entry, "skill-user-entry")}${decorations(context, entry.id)}${invocation}${userBlock}</div>`;
};

const resultAnchor = (context: EntryContext, toolCallId: string): string => {
  const resultId = context.resultEntries.get(toolCallId);
  return resultId === undefined
    ? ""
    : `<span class="entry-anchor" ${attributes(context, resultId)}></span>`;
};

const assistantBlock = (block: aiTypes.AssistantMessage["content"][number]): string => {
  if (block.type === "text") {
    return block.text.trim() === ""
      ? ""
      : `<div class="assistant-text markdown-content">${renderMarkdown(block.text)}</div>`;
  }
  if (block.type === "thinking") {
    return block.thinking.trim() === ""
      ? ""
      : `<div class="thinking-block"><div class="thinking-text">${escapeXml(block.thinking)}</div><div class="thinking-collapsed">Thinking ...</div></div>`;
  }
  return "";
};

const stopNote = (message: aiTypes.AssistantMessage): string => {
  if (message.stopReason === "aborted") return '<div class="error-text">Aborted</div>';
  if (message.stopReason !== "error") return "";
  return `<div class="error-text">Error: ${escapeXml(message.errorMessage ?? "Unknown error")}</div>`;
};

const renderAssistant = (
  context: EntryContext,
  entry: Entry,
  message: aiTypes.AssistantMessage,
): string => {
  const blocks = message.content.map(assistantBlock).join("");
  const calls = message.content
    .flatMap((block) => (block.type === "toolCall" ? [block] : []))
    .map((call) =>
      renderToolCall(
        call,
        context.graph.toolResults.get(call.id),
        context.renderedTools.get(call.id),
        resultAnchor(context, call.id),
      ),
    )
    .join("");
  return `${opening(context, entry, "assistant-message")}${decorations(context, entry.id)}${blocks}${calls}${stopNote(message)}</div>`;
};

const renderBashExecution = (
  context: EntryContext,
  entry: Entry,
  message: Extract<sessionViewTypes.MessageEntry["message"], { role: "bashExecution" }>,
): string => {
  const failed =
    message.exitCode !== undefined && message.exitCode !== null && message.exitCode !== 0;
  const status = message.cancelled
    ? '<div class="bash-cancelled">(cancelled)</div>'
    : failed
      ? `<div class="bash-exit">(exit ${message.exitCode})</div>`
      : "";
  const output = message.output === "" ? "" : formatOutput(message.output, 10);
  return `${opening(context, entry, `tool-execution ${message.cancelled || failed ? "error" : "success"}`)}${timestamp(context, entry.id)}<div class="tool-command">$ ${escapeXml(message.command)}</div>${output}${status}</div>`;
};

const empty = (context: EntryContext, entry: Entry): string =>
  `${opening(context, entry, "entry-anchor")}</div>`;

const renderMessage = (context: EntryContext, entry: sessionViewTypes.MessageEntry): string => {
  const { message } = entry;
  if (message.role === "user") return renderUser(context, entry, message);
  if (message.role === "assistant") return renderAssistant(context, entry, message);
  if (message.role === "bashExecution") return renderBashExecution(context, entry, message);
  if (message.role === "toolResult" && context.graph.toolCalls.has(message.toolCallId)) return "";
  return empty(context, entry);
};

const compactionOf = (
  context: EntryContext,
  entry: Extract<Entry, { type: "compaction" }>,
): string => {
  const tokens = `Compacted from ${entry.tokensBefore.toLocaleString()} tokens`;
  return `${opening(context, entry, "compaction follows-tools", "details")}<summary><div class="compaction-label">[compaction]</div><div class="compaction-collapsed">${tokens}</div></summary><div class="compaction-content"><strong>${tokens}</strong>\n\n${escapeXml(entry.summary)}</div></details>`;
};

const customOf = (
  context: EntryContext,
  entry: Extract<Entry, { type: "custom_message" }>,
): string => {
  const hidden = !entry.display;
  const body = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content);
  return `${opening(context, entry, `hook-message${hidden ? " hook-message-hidden" : ""}`)}${timestamp(context, entry.id)}<div class="hook-type">[${escapeXml(entry.customType)}]${hidden ? " · Hidden in terminal" : ""}</div><div class="markdown-content">${renderMarkdown(body)}</div></div>`;
};

const renderEntry = (context: EntryContext, entry: Entry): string => {
  switch (entry.type) {
    case "message":
      return renderMessage(context, entry);
    case "model_change":
      return `${opening(context, entry, "model-change")}${timestamp(context, entry.id)}Switched to model: <span class="model-name">${escapeXml(entry.provider)}/${escapeXml(entry.modelId)}</span></div>`;
    case "compaction":
      return compactionOf(context, entry);
    case "branch_summary":
      return `${opening(context, entry, "branch-summary")}${timestamp(context, entry.id)}<div class="branch-summary-header">Branch Summary</div><div class="markdown-content">${renderMarkdown(entry.summary)}</div></div>`;
    case "custom_message":
      return customOf(context, entry);
    default:
      return empty(context, entry);
  }
};

const resultEntriesOf = (entries: readonly Entry[]): ReadonlyMap<string, string> =>
  new Map(
    entries.flatMap((entry) =>
      entry.type === "message" && entry.message.role === "toolResult"
        ? [[entry.message.toolCallId, entry.id] as const]
        : [],
    ),
  );

const renderEntries = (context: Omit<EntryContext, "resultEntries">): string => {
  const full = { ...context, resultEntries: resultEntriesOf(context.graph.entries) };
  return context.graph.entries.map((entry) => renderEntry(full, entry)).join("\n");
};

const renderEntryModule = { renderEntries };

export default renderEntryModule;
