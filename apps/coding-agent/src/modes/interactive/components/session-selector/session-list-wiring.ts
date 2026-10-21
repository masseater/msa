import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../../core/awaiting.ts";
import themeModule from "../../theme/theme.ts";
import DynamicBorder from "../dynamic-border.ts";
import sessionSelectorHelpers from "../session-selector-helpers.ts";
import type sessionSelectorSearchTypes from "../session-selector-search.types.ts";
import type SessionSelectorComponent from "../session-selector.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { deleteSessionFile } = sessionSelectorHelpers;

const { Spacer } = tui;
const { theme } = themeModule;

export default class SessionListWiring {
  private readonly selector: SessionSelectorComponent;

  sortMode: sessionSelectorSearchTypes.SortMode = "threaded";

  nameFilter: sessionSelectorSearchTypes.NameFilter = "all";

  constructor(selector: SessionSelectorComponent) {
    this.selector = selector;
  }

  wireDeletion() {
    this.selector.sessionList.onDeleteSession = (sessionPath: string) =>
      Effect.runPromise(
        awaitingWith(function* () {
          const result = yield* awaited(deleteSessionFile(sessionPath));

          if (result.ok) {
            if (this.loading.currentSessions !== null) {
              this.loading.currentSessions = this.loading.currentSessions.filter(
                (s) => s.path !== sessionPath,
              );
            }
            if (this.loading.allSessions !== null) {
              this.loading.allSessions = this.loading.allSessions.filter(
                (s) => s.path !== sessionPath,
              );
            }

            const sessions =
              this.scope === "all"
                ? (this.loading.allSessions ?? [])
                : (this.loading.currentSessions ?? []);
            const showCwd = this.scope === "all";
            this.sessionList.setSessions(sessions, showCwd);

            const msg = result.method === "trash" ? "Session moved to trash" : "Session deleted";
            this.header.setStatusMessage({ message: msg, type: "info" }, 2000);
            yield* performed(this.loading.refreshSessionsAfterMutation());
          } else {
            const errorMessage = result.error ?? "Unknown error";
            this.header.setStatusMessage(
              { message: `Failed to delete: ${errorMessage}`, type: "error" },
              3000,
            );
          }

          this.requestRender();
        }, this.selector),
      );

    void Effect.runFork(this.selector.loading.loadScope("current"));
  }

  wireSelection(onSelect: (sessionPath: string) => void, onCancel: () => void): () => void {
    this.buildBaseLayout(this.selector.sessionList);

    this.selector.renameInput.onSubmit = (value) => {
      void Effect.runFork(this.selector.rename.confirmRename(value));
    };

    const clearStatusMessage = () => this.selector.header.setStatusMessage(null);
    this.selector.sessionList.onSelect = (sessionPath) => {
      clearStatusMessage();
      this.selector.loading.cancelLoads();
      onSelect(sessionPath);
    };
    this.selector.sessionList.onCancel = () => {
      clearStatusMessage();
      this.selector.loading.cancelLoads();
      onCancel();
    };
    return clearStatusMessage;
  }

  wireListActions(
    clearStatusMessage: () => void,
    onExit: () => void,
    renameSession:
      | ((sessionPath: string, currentName: string | undefined) => Promise<void>)
      | undefined,
  ): void {
    this.selector.sessionList.onExit = () => {
      clearStatusMessage();
      this.selector.loading.cancelLoads();
      onExit();
    };
    this.selector.sessionList.onToggleScope = () => this.selector.loading.toggleScope();
    this.selector.sessionList.onToggleSort = () => this.toggleSortMode();
    this.selector.sessionList.onToggleNameFilter = () => this.toggleNameFilter();
    this.selector.sessionList.onRenameSession = (sessionPath) => {
      if (renameSession === undefined) return;
      if (
        (this.selector.scope === "current"
          ? this.selector.loading.currentLoad
          : this.selector.loading.allLoad) !== null
      )
        return;

      const sessions =
        this.selector.scope === "all"
          ? (this.selector.loading.allSessions ?? [])
          : (this.selector.loading.currentSessions ?? []);
      const session = sessions.find((s) => s.path === sessionPath);
      this.selector.rename.enterRenameMode(sessionPath, session?.name);
    };

    this.selector.sessionList.onTogglePath = (showPath) => {
      this.selector.header.setShowPath(showPath);
      this.selector.requestRender();
    };
    this.selector.sessionList.onDeleteConfirmationChange = (path) => {
      this.selector.header.setConfirmingDeletePath(path);
      this.selector.requestRender();
    };
    this.selector.sessionList.onError = (msg) => {
      this.selector.header.setStatusMessage({ message: msg, type: "error" }, 3000);
      this.selector.requestRender();
    };
  }

  buildBaseLayout(content: tuiTypes.Component, options?: { showHeader?: boolean }): void {
    this.selector.clear();
    this.selector.addChild(new Spacer(1));
    this.selector.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    this.selector.addChild(new Spacer(1));
    if (options?.showHeader ?? true) {
      this.selector.addChild(this.selector.header);
      this.selector.addChild(new Spacer(1));
    }
    this.selector.addChild(content);
    this.selector.addChild(new Spacer(1));
    this.selector.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
  }

  toggleSortMode(): void {
    this.sortMode =
      this.sortMode === "threaded"
        ? "recent"
        : this.sortMode === "recent"
          ? "relevance"
          : "threaded";
    this.selector.header.setSortMode(this.sortMode);
    this.selector.sessionList.setSortMode(this.sortMode);
    this.selector.requestRender();
  }

  toggleNameFilter(): void {
    this.nameFilter = this.nameFilter === "all" ? "named" : "all";
    this.selector.header.setNameFilter(this.nameFilter);
    this.selector.sessionList.setNameFilter(this.nameFilter);
    this.selector.requestRender();
  }
}
