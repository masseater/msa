import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import sessionListHelpers from "./session-list-helpers.ts";
import type sessionListInternalTypes from "./session-list-internal.types.ts";
import SessionListLayer0 from "./session-list-layer-0.ts";
import SessionList from "./session-list.ts";
import sessionSelectorSearch from "./session-selector-search.ts";
import type sessionSelectorSearchTypes from "./session-selector-search.types.ts";

const { filterAndSortSessions, hasSessionName } = sessionSelectorSearch;
const { keyText } = keybindingHints;
const { theme } = themeModule;
const { getKeybindings, truncateToWidth } = tui;
const { buildSessionTree, canonicalizePath, flattenSessionTree, renderPart3 } = sessionListHelpers;

export default abstract class SessionListLayer1 extends SessionListLayer0 {
  public getSelectedSessionPath(): string | undefined {
    const selected = this.filteredSessions[this.selectedIndex];
    return selected?.session.path;
  }

  public onExit: () => void = () => {};

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.searchInput.focused = value;
  }

  setSortMode(sortMode: sessionSelectorSearchTypes.SortMode): void {
    this.sortMode = sortMode;
    this.filterSessions(this.searchInput.getValue());
  }

  setNameFilter(nameFilter: sessionSelectorSearchTypes.NameFilter): void {
    this.nameFilter = nameFilter;
    this.filterSessions(this.searchInput.getValue());
  }

  setSessions(sessions: sessionManagerTypes.SessionInfo[], showCwd: boolean): void {
    const selectedPath = this.selectionTouched ? this.getSelectedSessionPath() : undefined;
    this.allSessions = sessions;
    this.showCwd = showCwd;
    this.filterSessions(this.searchInput.getValue());
    if (!this.selectionTouched) {
      this.selectedIndex = 0;
    } else if (selectedPath !== undefined && selectedPath !== "") {
      const selectedIndex = this.filteredSessions.findIndex(
        (node) => node.session.path === selectedPath,
      );
      if (selectedIndex >= 0) this.selectedIndex = selectedIndex;
    }
  }

  protected filterSessions(query: string): void {
    const trimmed = query.trim();
    const nameFiltered =
      this.nameFilter === "all"
        ? this.allSessions
        : this.allSessions.filter((session) => hasSessionName(session));

    if (this.sortMode === "threaded" && trimmed === "") {
      const roots = buildSessionTree(nameFiltered);
      this.filteredSessions = flattenSessionTree(roots);
    } else {
      const filtered = filterAndSortSessions(nameFiltered, query, this.sortMode, "all");
      this.filteredSessions = filtered.map((session) => ({
        ancestorContinues: [],
        depth: 0,
        isLast: true,
        session,
      }));
    }
    this.selectedIndex = Math.min(
      this.selectedIndex,
      Math.max(0, this.filteredSessions.length - 1),
    );
  }

  protected setConfirmingDeletePath(path: string | null): void {
    this.confirmingDeletePath = path;
    this.onDeleteConfirmationChange?.(path);
  }

  protected startDeleteConfirmationForSelectedSession(): void {
    const selected = this.filteredSessions[this.selectedIndex];
    if (selected === undefined) return;

    if (this.isCurrentSessionPath(selected.session.path)) {
      this.onError?.("Cannot delete the currently active session");
      return;
    }

    this.setConfirmingDeletePath(selected.session.path);
  }

  isCurrentSessionPath(path: string): boolean {
    if (this.currentSessionCanonicalPath === undefined || this.currentSessionCanonicalPath === "")
      return false;
    return (canonicalizePath(path) ?? path) === this.currentSessionCanonicalPath;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(...this.searchInput.render(width));
    lines.push("");

    if (this.filteredSessions.length === 0) {
      let emptyMessage: string;
      if (this.nameFilter === "named") {
        const toggleKey = keyText("app.session.toggleNamedFilter");
        if (this.showCwd) {
          emptyMessage = `  No named sessions found. Press ${toggleKey} to show all.`;
        } else {
          emptyMessage = `  No named sessions in current folder. Press ${toggleKey} to show all, or Tab to view all.`;
        }
      } else if (this.showCwd) {
        emptyMessage = "  No sessions found";
      } else {
        emptyMessage = "  No sessions in current folder. Press Tab to view all.";
      }
      lines.push(theme.fg("muted", truncateToWidth(emptyMessage, width, "…")));
      return lines;
    }

    const { startIndex, endIndex } = SessionList.renderStartIndex(this as unknown as SessionList);

    for (let i = startIndex; i < endIndex; i++) {
      let { isSelected, styledMsg, cursor, prefix, rightPart, isConfirmingDelete } =
        SessionList.renderIsSelected(this as unknown as SessionList, i, width);
      if (isSelected) {
        styledMsg = theme.bold(styledMsg);
      }

      renderPart3(
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

    return this.renderPart1(startIndex, endIndex, width, lines);
  }

  protected renderPart1(startIndex: number, endIndex: number, width: number, lines: string[]) {
    if (startIndex > 0 || endIndex < this.filteredSessions.length) {
      const scrollText = `  (${this.selectedIndex + 1}/${this.filteredSessions.length})`;
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

  handleInput(keyData: string): void {
    const kb = getKeybindings();

    if (this.confirmingDeletePath !== null) {
      if (kb.matches(keyData, "tui.select.confirm")) {
        const pathToDelete = this.confirmingDeletePath;
        this.setConfirmingDeletePath(null);
        void this.onDeleteSession?.(pathToDelete);
        return;
      }
      if (kb.matches(keyData, "tui.select.cancel")) {
        this.setConfirmingDeletePath(null);
        return;
      }
      return;
    }

    if (kb.matches(keyData, "tui.input.tab")) {
      if (this.onToggleScope !== undefined) {
        this.onToggleScope();
      }
      return;
    }

    if (kb.matches(keyData, "app.session.toggleSort")) {
      this.onToggleSort?.();
      return;
    }

    if (this.keybindings.matches(keyData, "app.session.toggleNamedFilter")) {
      this.onToggleNameFilter?.();
      return;
    }

    if (kb.matches(keyData, "app.session.togglePath")) {
      this.showPath = !this.showPath;
      this.onTogglePath?.(this.showPath);
      return;
    }

    if (kb.matches(keyData, "app.session.delete")) {
      this.startDeleteConfirmationForSelectedSession();
      return;
    }

    if (kb.matches(keyData, "app.session.rename")) {
      return this.handleInputPart2();
    }

    if (kb.matches(keyData, "app.session.deleteNoninvasive")) {
      if (this.searchInput.getValue().length > 0) {
        this.searchInput.handleInput(keyData);
        this.filterSessions(this.searchInput.getValue());
        return;
      }

      this.startDeleteConfirmationForSelectedSession();
      return;
    }

    this.handleInputPart1(kb, keyData);
  }

  protected handleInputPart2(): void {
    const selected = this.filteredSessions[this.selectedIndex];
    if (selected !== undefined) {
      this.onRenameSession?.(selected.session.path);
    }
  }

  protected handleInputPart1(kb: tuiTypes.KeybindingsManager, keyData: string) {
    this.selectionTouched = true;
    if (kb.matches(keyData, "tui.select.up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (kb.matches(keyData, "tui.select.down")) {
      this.selectedIndex = Math.min(this.filteredSessions.length - 1, this.selectedIndex + 1);
    } else if (kb.matches(keyData, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
    } else if (kb.matches(keyData, "tui.select.pageDown")) {
      this.selectedIndex = Math.min(
        this.filteredSessions.length - 1,
        this.selectedIndex + this.maxVisible,
      );
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selected = this.filteredSessions[this.selectedIndex];
      if (selected !== undefined && this.onSelect !== undefined) {
        this.onSelect(selected.session.path);
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      if (this.onCancel !== undefined) {
        this.onCancel();
      }
    } else {
      this.searchInput.handleInput(keyData);
      this.filterSessions(this.searchInput.getValue());
    }
  }
}
