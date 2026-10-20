import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type keybindingsTypes from "../../../core/keybindings.types.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import paths from "../../../utils/paths.ts";
import themeModule from "../theme/theme.ts";
import sessionListHelpers from "./session-list-helpers.ts";
import type sessionListInternalTypes from "./session-list-internal.types.ts";
import SessionListLayer1 from "./session-list-layer-1.ts";
import type sessionSelectorSearchTypes from "./session-selector-search.types.ts";

const { Input, truncateToWidth, visibleWidth } = tui;
const { abbreviateHomePath } = paths;
const { theme } = themeModule;
const { canonicalizePath, formatSessionDate } = sessionListHelpers;

export default class SessionList
  extends SessionListLayer1
  implements tuiTypes.Component, tuiTypes.Focusable
{
  static renderStartIndex(self: SessionList): { startIndex: number; endIndex: number } {
    const startIndex = Math.max(
      0,
      Math.min(
        self.selectedIndex - Math.floor(self.maxVisible / 2),
        self.filteredSessions.length - self.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + self.maxVisible, self.filteredSessions.length);
    return { endIndex, startIndex };
  }

  static renderIsSelected(
    self: SessionList,
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
    const node = self.filteredSessions[i]!;
    const session = node.session;
    const isSelected = i === self.selectedIndex;
    const isConfirmingDelete = session.path === self.confirmingDeletePath;
    const { prefix, normalizedMessage, isCurrent, hasName } = SessionList.renderIsSelectedPart1(
      self,
      session,
      node,
    );

    let rightPart = SessionList.renderIsSelectedPart2(session, self);
    if (self.showPath) {
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

  static renderIsSelectedPart2(session: sessionManagerTypes.SessionInfo, self: SessionList) {
    const age = formatSessionDate(session.modified);
    const msgCount = String(session.messageCount);
    let rightPart = `${msgCount} ${age}`;
    if (self.showCwd && session.cwd !== "") {
      rightPart = `${abbreviateHomePath(session.cwd)} ${rightPart}`;
    }
    return rightPart;
  }

  static renderIsSelectedPart1(
    self: SessionList,
    session: sessionManagerTypes.SessionInfo,
    node: sessionListInternalTypes.FlatSessionNode,
  ) {
    const isCurrent = self.isCurrentSessionPath(session.path);

    const prefix = self.buildTreePrefix(node);

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

  constructor(
    sessions: sessionManagerTypes.SessionInfo[],
    showCwd: boolean,
    sortMode: sessionSelectorSearchTypes.SortMode,
    nameFilter: sessionSelectorSearchTypes.NameFilter,
    keybindings: keybindingsTypes.KeybindingsManager,
    currentSessionFilePath?: string,
  ) {
    super();
    this.allSessions = sessions;
    this.filteredSessions = [];
    this.searchInput = new Input();
    this.showCwd = showCwd;
    this.sortMode = sortMode;
    this.nameFilter = nameFilter;
    this.keybindings = keybindings;
    this.currentSessionCanonicalPath = canonicalizePath(currentSessionFilePath);
    this.filterSessions("");

    this.searchInput.onSubmit = () => {
      const selected = this.filteredSessions[this.selectedIndex];
      if (selected !== undefined) {
        if (this.onSelect !== undefined) {
          this.onSelect(selected.session.path);
        }
      }
    };
  }
}
