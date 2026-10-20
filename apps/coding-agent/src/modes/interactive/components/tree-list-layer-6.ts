import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import themeModule from "../theme/theme.ts";
import TreeListLayer5 from "./tree-list-layer-5.ts";

const { theme } = themeModule;

export default abstract class TreeListLayer6 extends TreeListLayer5 {
  getEntryDisplayText(node: sessionManagerTypes.SessionTreeNode, isSelected: boolean): string {
    const entry = node.entry;
    let result: string;

    const normalize = (s: string) => s.replace(/[\n\t]/gu, " ").trim();

    switch (entry.type) {
      case "message": {
        const msg = entry.message;
        const role = msg.role;
        if (role === "user") {
          const msgWithContent = msg as { content?: unknown };
          const content = normalize(this.extractContent(msgWithContent.content));
          result = theme.fg("accent", "user: ") + content;
        } else if (role === "assistant") {
          const msgWithContent = msg as {
            content?: unknown;
            stopReason?: string;
            errorMessage?: string;
          };
          const textContent = normalize(this.extractContent(msgWithContent.content));
          if (textContent !== "") {
            result = theme.fg("success", "assistant: ") + textContent;
          } else if (msgWithContent.stopReason === "aborted") {
            result = theme.fg("success", "assistant: ") + theme.fg("muted", "(aborted)");
          } else if (
            msgWithContent.errorMessage !== undefined &&
            msgWithContent.errorMessage !== ""
          ) {
            const errMsg = normalize(msgWithContent.errorMessage).slice(0, 80);
            result = theme.fg("success", "assistant: ") + theme.fg("error", errMsg);
          } else {
            result = theme.fg("success", "assistant: ") + theme.fg("muted", "(no content)");
          }
        } else if (role === "toolResult") {
          const toolMsg = msg as { toolCallId?: string; toolName?: string };
          const toolCall =
            toolMsg.toolCallId !== undefined && toolMsg.toolCallId !== ""
              ? this.toolCallMap.get(toolMsg.toolCallId)
              : undefined;
          if (toolCall === undefined) {
            result = theme.fg("muted", `[${toolMsg.toolName ?? "tool"}]`);
          } else {
            result = theme.fg("muted", this.formatToolCall(toolCall.name, toolCall.arguments));
          }
        } else if (role === "bashExecution") {
          const bashMsg = msg as { command?: string };
          result = theme.fg("dim", `[bash]: ${normalize(bashMsg.command ?? "")}`);
        } else {
          result = theme.fg("dim", `[${role}]`);
        }
        break;
      }
      case "custom_message": {
        const content = this.getEntryDisplayTextPart1(entry);
        result = theme.fg("customMessageLabel", `[${entry.customType}]: `) + normalize(content);
        break;
      }
      case "compaction": {
        const tokens = Math.round(entry.tokensBefore / 1000);
        result = theme.fg("borderAccent", `[compaction: ${tokens}k tokens]`);
        break;
      }
      case "branch_summary":
        result = theme.fg("warning", `[branch summary]: `) + normalize(entry.summary);
        break;
      case "model_change":
        result = theme.fg("dim", `[model: ${entry.modelId}]`);
        break;
      case "thinking_level_change":
        result = theme.fg("dim", `[thinking: ${entry.thinkingLevel}]`);
        break;
      case "custom":
        result = theme.fg("dim", `[custom: ${entry.customType}]`);
        break;
      case "context_edit":
        result = theme.fg(
          "dim",
          `[context ${entry.replacement === null ? "omit" : "replace"}: ${entry.targetId}]`,
        );
        break;
      case "label":
        result = theme.fg("dim", `[label: ${entry.label ?? "(cleared)"}]`);
        break;
      case "session_info":
        result =
          entry.name !== undefined && entry.name !== ""
            ? [theme.fg("dim", "[title: "), theme.fg("dim", entry.name), theme.fg("dim", "]")].join(
                "",
              )
            : [
                theme.fg("dim", "[title: "),
                theme.italic(theme.fg("dim", "empty")),
                theme.fg("dim", "]"),
              ].join("");
        break;
      default:
        result = "";
    }

    return isSelected ? theme.bold(result) : result;
  }
}
