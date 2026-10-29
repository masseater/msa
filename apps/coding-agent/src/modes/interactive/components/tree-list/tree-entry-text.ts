import platform from "../../../../core/platform/index.ts";
import type sessionManagerTypes from "../../../../core/session-manager.types.ts";
import renderUtils from "../../../../core/tools/render-utils.ts";
import themeModule from "../../theme/theme.ts";
import type TreeList from "../tree-list.ts";

const { formatLocalTime, nowMs } = platform;
const { formatReadLineRange, shortenPath } = renderUtils;
const { theme } = themeModule;

type MessageEntry = Extract<sessionManagerTypes.SessionEntry, { type: "message" }>;

const normalize = (text: string): string => text.replace(/[\n\t]/gu, " ").trim();

export default class TreeEntryText {
  private readonly list: TreeList;

  constructor(list: TreeList) {
    this.list = list;
  }

  private entryDisplayPrefix(entry: sessionManagerTypes.CustomMessageEntry<unknown>) {
    return typeof entry.content === "string"
      ? entry.content
      : entry.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("");
  }

  extractContent(content: unknown): string {
    return this.extractFullContent(content).slice(0, 200);
  }

  private extractFullContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";

    let result = "";
    for (const block of content) {
      if (typeof block === "object" && block !== null && "type" in block && block.type === "text") {
        result += (block as { text: string }).text;
      }
    }
    return result;
  }

  getEntryCopyText(node: sessionManagerTypes.SessionTreeNode): string | undefined {
    const entry = node.entry;
    let text: string | undefined;

    switch (entry.type) {
      case "message":
        if (entry.message.role === "bashExecution") {
          text = entry.message.command;
        } else if ("content" in entry.message) {
          text = this.extractFullContent(entry.message.content);
          if (text === "" && entry.message.role === "assistant") {
            text = entry.message.errorMessage;
          }
        }
        break;
      case "custom_message":
        text = this.extractFullContent(entry.content);
        break;
      case "compaction":
        text = entry.summary;
        break;
      case "branch_summary":
        text = entry.summary;
        break;
    }

    return (text?.trim() ?? "") === "" ? undefined : text;
  }

  formatLabelTimestamp(timestamp: string): string {
    const now = nowMs();
    const sameAsNow = (layout: string): boolean =>
      formatLocalTime(timestamp, layout) === formatLocalTime(now, layout);
    if (sameAsNow("YYYY-MM-DD")) return formatLocalTime(timestamp, "HH:mm");
    if (sameAsNow("YYYY")) return formatLocalTime(timestamp, "M/D HH:mm");
    return formatLocalTime(timestamp, "YY/M/D HH:mm");
  }

  private formatToolCall(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case "read": {
        const path = shortenPath(String(args["path"] || args["file_path"] || ""));
        return `[read: ${path}${formatReadLineRange(args["offset"], args["limit"])}]`;
      }
      case "write": {
        const path = shortenPath(String(args["path"] || args["file_path"] || ""));
        return `[write: ${path}]`;
      }
      case "edit": {
        const path = shortenPath(String(args["path"] || args["file_path"] || ""));
        return `[edit: ${path}]`;
      }
      case "bash": {
        const rawCmd = String(args["command"] || "");
        const cmd = rawCmd
          .replace(/[\n\t]/gu, " ")
          .trim()
          .slice(0, 50);
        return `[bash: ${cmd}${rawCmd.length > 50 ? "..." : ""}]`;
      }
      case "grep": {
        const pattern = String(args["pattern"] || "");
        const path = shortenPath(String(args["path"] || "."));
        return `[grep: /${pattern}/ in ${path}]`;
      }
      case "find": {
        const pattern = String(args["pattern"] || "");
        const path = shortenPath(String(args["path"] || "."));
        return `[find: ${pattern} in ${path}]`;
      }
      case "ls": {
        const path = shortenPath(String(args["path"] || "."));
        return `[ls: ${path}]`;
      }
      default: {
        const argsStr = JSON.stringify(args).slice(0, 40);
        return `[${name}: ${argsStr}${JSON.stringify(args).length > 40 ? "..." : ""}]`;
      }
    }
  }

  getEntryDisplayText(node: sessionManagerTypes.SessionTreeNode, isSelected: boolean): string {
    const { entry } = node;
    const result =
      entry.type === "message" ? this.messageText(entry.message) : this.nonMessageText(entry);
    return isSelected ? theme.bold(result) : result;
  }

  private messageText(msg: MessageEntry["message"]): string {
    const { role } = msg;
    if (role === "user") {
      const content = normalize(this.extractContent((msg as { content?: unknown }).content));
      return theme.fg("accent", "user: ") + content;
    }
    if (role === "assistant") return this.assistantText(msg);
    if (role === "toolResult") {
      const toolMsg = msg as { toolCallId?: string; toolName?: string };
      const toolCall =
        toolMsg.toolCallId !== undefined && toolMsg.toolCallId !== ""
          ? this.list.toolCallMap.get(toolMsg.toolCallId)
          : undefined;
      return toolCall === undefined
        ? theme.fg("muted", `[${toolMsg.toolName ?? "tool"}]`)
        : theme.fg("muted", this.formatToolCall(toolCall.name, toolCall.arguments));
    }
    if (role === "bashExecution") {
      const bashMsg = msg as { command?: string };
      return theme.fg("dim", `[bash]: ${normalize(bashMsg.command ?? "")}`);
    }
    return theme.fg("dim", `[${role}]`);
  }

  private assistantText(msg: MessageEntry["message"]): string {
    const message = msg as { content?: unknown; stopReason?: string; errorMessage?: string };
    const label = theme.fg("success", "assistant: ");
    const textContent = normalize(this.extractContent(message.content));
    if (textContent !== "") return label + textContent;
    if (message.stopReason === "aborted") return label + theme.fg("muted", "(aborted)");
    if (message.errorMessage !== undefined && message.errorMessage !== "") {
      return label + theme.fg("error", normalize(message.errorMessage).slice(0, 80));
    }
    return label + theme.fg("muted", "(no content)");
  }

  private nonMessageText(entry: Exclude<sessionManagerTypes.SessionEntry, MessageEntry>): string {
    switch (entry.type) {
      case "custom_message":
        return (
          theme.fg("customMessageLabel", `[${entry.customType}]: `) +
          normalize(this.entryDisplayPrefix(entry))
        );
      case "compaction":
        return theme.fg(
          "borderAccent",
          `[compaction: ${Math.round(entry.tokensBefore / 1000)}k tokens]`,
        );
      case "branch_summary":
        return theme.fg("warning", `[branch summary]: `) + normalize(entry.summary);
      case "model_change":
        return theme.fg("dim", `[model: ${entry.modelId}]`);
      case "thinking_level_change":
        return theme.fg("dim", `[thinking: ${entry.thinkingLevel}]`);
      case "custom":
        return theme.fg("dim", `[custom: ${entry.customType}]`);
      case "context_edit":
        return theme.fg(
          "dim",
          `[context ${entry.replacement === null ? "omit" : "replace"}: ${entry.targetId}]`,
        );
      case "label":
        return theme.fg("dim", `[label: ${entry.label ?? "(cleared)"}]`);
      case "session_info":
        return [
          theme.fg("dim", "[title: "),
          entry.name !== undefined && entry.name !== ""
            ? theme.fg("dim", entry.name)
            : theme.italic(theme.fg("dim", "empty")),
          theme.fg("dim", "]"),
        ].join("");
      default:
        return "";
    }
  }
}
