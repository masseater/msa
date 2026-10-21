import tui from "@msa/tui";

import type sessionManagerTypes from "../../../../core/session-manager.types.ts";
import paths from "../../../../utils/paths.ts";
import themeModule from "../../theme/theme.ts";
import keybindingHints from "../keybinding-hints.ts";
import sessionListHelpers from "../session-list-helpers.ts";
import type sessionListInternalTypes from "../session-list-internal.types.ts";
import type SessionList from "../session-list.ts";

const { theme } = themeModule;
const { truncateToWidth, visibleWidth } = tui;
const { appendSessionLine, formatSessionDate } = sessionListHelpers;
const { abbreviateHomePath } = paths;
const { keyText } = keybindingHints;

export default class SessionListRendering {
  private readonly list: SessionList;

  constructor(list: SessionList) {
    this.list = list;
  }

  appendScrollInfo(startIndex: number, endIndex: number, width: number, lines: string[]) {
    if (startIndex > 0 || endIndex < this.list.filteredSessions.length) {
      const scrollText = `  (${this.list.selectedIndex + 1}/${this.list.filteredSessions.length})`;
      const scrollInfo = theme.fg("muted", truncateToWidth(scrollText, width, ""));
      lines.push(scrollInfo);
    }

    return lines;
  }

  buildTreePrefix(node: sessionListInternalTypes.FlatSessionNode): string {
    if (node.depth === 0) {
      return "";
    }

    const parts = node.ancestorContinues.map((continues) => (continues ? "│  " : "   "));
    const branch = node.isLast ? "└─ " : "├─ ";
    return parts.join("") + branch;
  }

  visibleRange(): { startIndex: number; endIndex: number } {
    const startIndex = Math.max(
      0,
      Math.min(
        this.list.selectedIndex - Math.floor(this.list.maxVisible / 2),
        this.list.filteredSessions.length - this.list.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.list.maxVisible, this.list.filteredSessions.length);
    return { endIndex, startIndex };
  }

  renderSessionRow(
    i: number,
    width: number,
  ): {
    isSelected: boolean;
    styledMsg: string;
    cursor: string;
    prefix: string;
    rightPart: string;
    isConfirmingDelete: boolean;
  } {
    const node = this.list.filteredSessions[i]!;
    const session = node.session;
    const isSelected = i === this.list.selectedIndex;
    const isConfirmingDelete = session.path === this.list.confirmingDeletePath;
    const { prefix, normalizedMessage, isCurrent, hasName } = this.rowTitle(session, node);

    let rightPart = this.rowMeta(session);
    if (this.list.showPath) {
      rightPart = `${abbreviateHomePath(session.path)} ${rightPart}`;
    }

    const cursor = isSelected ? theme.fg("accent", "› ") : "  ";

    const prefixWidth = visibleWidth(prefix);
    const rightWidth = visibleWidth(rightPart) + 2;
    const availableForMsg = width - 2 - prefixWidth - rightWidth;

    const truncatedMsg = truncateToWidth(normalizedMessage, Math.max(10, availableForMsg), "…");

    let messageColor: "error" | "warning" | "accent" | null = null;
    if (isConfirmingDelete) {
      messageColor = "error";
    } else if (isCurrent) {
      messageColor = "accent";
    } else if (hasName) {
      messageColor = "warning";
    }
    let styledMsg = messageColor === null ? truncatedMsg : theme.fg(messageColor, truncatedMsg);
    return { cursor, isConfirmingDelete, isSelected, prefix, rightPart, styledMsg };
  }

  rowMeta(session: sessionManagerTypes.SessionInfo) {
    const age = formatSessionDate(session.modified);
    const msgCount = String(session.messageCount);
    let rightPart = `${msgCount} ${age}`;
    if (this.list.showCwd && session.cwd !== "") {
      rightPart = `${abbreviateHomePath(session.cwd)} ${rightPart}`;
    }
    return rightPart;
  }

  rowTitle(
    session: sessionManagerTypes.SessionInfo,
    node: sessionListInternalTypes.FlatSessionNode,
  ) {
    const isCurrent = this.list.isCurrentSessionPath(session.path);

    const prefix = this.buildTreePrefix(node);

    const hasName = session.name !== undefined && session.name !== "";
    const displayText = session.name ?? session.firstMessage;
    const normalizedMessage = Array.from(displayText, (ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
      .join("")
      .trim();
    return { hasName, isCurrent, normalizedMessage, prefix };
  }

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(...this.list.searchInput.render(width));
    lines.push("");

    if (this.list.filteredSessions.length === 0) {
      let emptyMessage: string;
      if (this.list.nameFilter === "named") {
        const toggleKey = keyText("app.session.toggleNamedFilter");
        if (this.list.showCwd) {
          emptyMessage = `  No named sessions found. Press ${toggleKey} to show all.`;
        } else {
          emptyMessage = `  No named sessions in current folder. Press ${toggleKey} to show all, or Tab to view all.`;
        }
      } else if (this.list.showCwd) {
        emptyMessage = "  No sessions found";
      } else {
        emptyMessage = "  No sessions in current folder. Press Tab to view all.";
      }
      lines.push(theme.fg("muted", truncateToWidth(emptyMessage, width, "…")));
      return lines;
    }

    const { startIndex, endIndex } = this.visibleRange();

    for (let i = startIndex; i < endIndex; i++) {
      let { isSelected, styledMsg, cursor, prefix, rightPart, isConfirmingDelete } =
        this.renderSessionRow(i, width);
      if (isSelected) {
        styledMsg = theme.bold(styledMsg);
      }

      appendSessionLine(
        cursor,
        prefix,
        styledMsg,
        width,
        rightPart,
        isConfirmingDelete,
        isSelected,
        lines,
      );
    }

    return this.appendScrollInfo(startIndex, endIndex, width, lines);
  }
}
