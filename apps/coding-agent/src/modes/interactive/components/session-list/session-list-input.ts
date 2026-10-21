import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type SessionList from "../session-list.ts";

const { getKeybindings } = tui;

export default class SessionListInput {
  private readonly list: SessionList;

  constructor(list: SessionList) {
    this.list = list;
  }

  private setConfirmingDeletePath(path: string | null): void {
    this.list.confirmingDeletePath = path;
    this.list.onDeleteConfirmationChange?.(path);
  }

  private startDeleteConfirmationForSelectedSession(): void {
    const selected = this.list.filteredSessions[this.list.selectedIndex];
    if (selected === undefined) return;

    if (this.list.isCurrentSessionPath(selected.session.path)) {
      this.list.onError?.("Cannot delete the currently active session");
      return;
    }

    this.setConfirmingDeletePath(selected.session.path);
  }

  handleInput(keyData: string): void {
    const kb = getKeybindings();
    if (this.list.confirmingDeletePath !== null) {
      this.handleDeleteConfirmation(kb, keyData);
      return;
    }
    const action = this.listActions(keyData).find(([matches]) => matches(kb));
    if (action === undefined) this.handleNavigation(kb, keyData);
    else action[1]();
  }

  private handleDeleteConfirmation(kb: tuiTypes.KeybindingsManager, keyData: string): void {
    const pathToDelete = this.list.confirmingDeletePath;
    if (kb.matches(keyData, "tui.select.confirm") && pathToDelete !== null) {
      this.setConfirmingDeletePath(null);
      void this.list.onDeleteSession?.(pathToDelete);
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      this.setConfirmingDeletePath(null);
    }
  }

  private listActions(
    keyData: string,
  ): Array<[(kb: tuiTypes.KeybindingsManager) => boolean, () => void]> {
    const { list } = this;
    const on =
      (binding: Parameters<tuiTypes.KeybindingsManager["matches"]>[1]) =>
      (kb: tuiTypes.KeybindingsManager) =>
        kb.matches(keyData, binding);
    return [
      [on("tui.input.tab"), () => list.onToggleScope?.()],
      [on("app.session.toggleSort"), () => list.onToggleSort?.()],
      [
        () => list.keybindings.matches(keyData, "app.session.toggleNamedFilter"),
        () => list.onToggleNameFilter?.(),
      ],
      [
        on("app.session.togglePath"),
        () => {
          list.showPath = !list.showPath;
          list.onTogglePath?.(list.showPath);
        },
      ],
      [on("app.session.delete"), () => this.startDeleteConfirmationForSelectedSession()],
      [on("app.session.rename"), () => this.renameSelected()],
      [on("app.session.deleteNoninvasive"), () => this.deleteCharOrConfirm(keyData)],
    ];
  }

  private deleteCharOrConfirm(keyData: string): void {
    if (this.list.searchInput.getValue().length > 0) {
      this.list.searchInput.handleInput(keyData);
      this.list.filterSessions(this.list.searchInput.getValue());
      return;
    }
    this.startDeleteConfirmationForSelectedSession();
  }

  private renameSelected(): void {
    const selected = this.list.filteredSessions[this.list.selectedIndex];
    if (selected !== undefined) {
      this.list.onRenameSession?.(selected.session.path);
    }
  }

  private handleNavigation(kb: tuiTypes.KeybindingsManager, keyData: string) {
    this.list.selectionTouched = true;
    if (kb.matches(keyData, "tui.select.up")) {
      this.list.selectedIndex = Math.max(0, this.list.selectedIndex - 1);
    } else if (kb.matches(keyData, "tui.select.down")) {
      this.list.selectedIndex = Math.min(
        this.list.filteredSessions.length - 1,
        this.list.selectedIndex + 1,
      );
    } else if (kb.matches(keyData, "tui.select.pageUp")) {
      this.list.selectedIndex = Math.max(0, this.list.selectedIndex - this.list.maxVisible);
    } else if (kb.matches(keyData, "tui.select.pageDown")) {
      this.list.selectedIndex = Math.min(
        this.list.filteredSessions.length - 1,
        this.list.selectedIndex + this.list.maxVisible,
      );
    } else if (kb.matches(keyData, "tui.select.confirm")) {
      const selected = this.list.filteredSessions[this.list.selectedIndex];
      if (selected !== undefined && this.list.onSelect !== undefined) {
        this.list.onSelect(selected.session.path);
      }
    } else if (kb.matches(keyData, "tui.select.cancel")) {
      if (this.list.onCancel !== undefined) {
        this.list.onCancel();
      }
    } else {
      this.list.searchInput.handleInput(keyData);
      this.list.filterSessions(this.list.searchInput.getValue());
    }
  }
}
