import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import awaitingModule from "../../../core/awaiting.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";
import SessionList from "./session-list.ts";
import sessionSelectorHelpers from "./session-selector-helpers.ts";
import type sessionSelectorInternalTypes from "./session-selector-internal.types.ts";
import SessionSelectorComponentLayer0 from "./session-selector-layer-0.ts";
import SessionSelectorComponent from "./session-selector.ts";

const { Spacer, getKeybindings } = tui;
const { theme } = themeModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const { deleteSessionFile } = sessionSelectorHelpers;

export default abstract class SessionSelectorComponentLayer1 extends SessionSelectorComponentLayer0 {
  handleInput(data: string): void {
    if (this.mode === "rename") {
      const kb = getKeybindings();
      if (kb.matches(data, "tui.select.cancel")) {
        this.exitRenameMode();
        return;
      }
      this.renameInput.handleInput(data);
      return;
    }

    this.sessionList.handleInput(data);
  }

  get focused(): boolean {
    return this.focusedState;
  }

  set focused(value: boolean) {
    this.focusedState = value;
    this.sessionList.focused = value;
    this.renameInput.focused = value;
    if (value && this.mode === "rename") {
      this.renameInput.focused = true;
    }
  }

  buildBaseLayout(content: tuiTypes.Component, options?: { showHeader?: boolean }): void {
    this.clear();
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
    this.addChild(new Spacer(1));
    if (options?.showHeader ?? true) {
      this.addChild(this.header);
      this.addChild(new Spacer(1));
    }
    this.addChild(content);
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
  }

  protected constructPart1() {
    this.sessionList.onDeleteSession = (sessionPath: string) =>
      Effect.runPromise(
        awaitingWith(
          function* () {
            const result = yield* awaited(deleteSessionFile(sessionPath));

            if (result.ok) {
              if (this.currentSessions !== null) {
                this.currentSessions = this.currentSessions.filter((s) => s.path !== sessionPath);
              }
              if (this.allSessions !== null) {
                this.allSessions = this.allSessions.filter((s) => s.path !== sessionPath);
              }

              const sessions =
                this.scope === "all" ? (this.allSessions ?? []) : (this.currentSessions ?? []);
              const showCwd = this.scope === "all";
              this.sessionList.setSessions(sessions, showCwd);

              const msg = result.method === "trash" ? "Session moved to trash" : "Session deleted";
              this.header.setStatusMessage({ message: msg, type: "info" }, 2000);
              yield* performed(this.refreshSessionsAfterMutation());
            } else {
              const errorMessage = result.error ?? "Unknown error";
              this.header.setStatusMessage(
                { message: `Failed to delete: ${errorMessage}`, type: "error" },
                3000,
              );
            }

            this.requestRender();
          },
          this as unknown as SessionSelectorComponent,
        ),
      );

    void Effect.runFork(this.loadScope("current"));
  }

  cancelLoads(): void {
    if (this.currentLoad !== null) {
      this.currentLoad.abort();
      this.currentLoad = null;
      this.currentSessions = null;
    }
    if (this.allLoad !== null) {
      this.allLoad.abort();
      this.allLoad = null;
      this.allSessions = null;
    }
  }

  protected exitRenameMode(): void {
    this.mode = "list";
    this.renameTargetPath = null;

    this.buildBaseLayout(this.sessionList);

    this.requestRender();
  }

  confirmRename(value: string): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        const next = value.trim();
        if (next === "") return;
        const target = this.renameTargetPath;
        if (target === null || target === "") {
          this.exitRenameMode();
          return;
        }

        const renameSession = this.renameSession;
        if (renameSession === undefined) {
          this.exitRenameMode();
          return;
        }

        try {
          yield* awaited(renameSession(target, next));
          yield* performed(this.refreshSessionsAfterMutation());
        } finally {
          this.exitRenameMode();
        }
      },
      this as unknown as SessionSelectorComponent,
    );
  }

  protected loadScope(scope: sessionSelectorInternalTypes.SessionScope): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        if ((scope === "current" ? this.currentLoad : this.allLoad) !== null) return;

        const { onProgress, controller, isActive, showCwd } =
          SessionSelectorComponent.loadScopeOnProgress(
            this as unknown as SessionSelectorComponent,
            scope,
          );

        try {
          const sessions = yield* awaited(
            scope === "current"
              ? this.currentSessionsLoader(onProgress, controller.signal)
              : this.allSessionsLoader(onProgress, controller.signal),
          );
          if (!isActive()) return;

          if (scope === "current") {
            this.currentSessions = sessions;
            this.currentLoad = null;
          } else {
            this.allSessions = sessions;
            this.allLoad = null;
          }

          if (scope !== this.scope) return;
          this.header.setLoading(false);
          this.sessionList.setSessions(sessions, showCwd);
          this.requestRender();
        } catch (err) {
          if (!isActive()) return;
          if (scope === "current") {
            this.currentLoad = null;
            this.currentSessions = null;
          } else {
            this.allLoad = null;
            this.allSessions = null;
          }
          if (scope !== this.scope) return;

          SessionSelectorComponent.loadScopePart2(
            this as unknown as SessionSelectorComponent,
            err,
            showCwd,
          );
        }
      },
      this as unknown as SessionSelectorComponent,
    );
  }

  toggleSortMode(): void {
    this.sortMode =
      this.sortMode === "threaded"
        ? "recent"
        : this.sortMode === "recent"
          ? "relevance"
          : "threaded";
    this.header.setSortMode(this.sortMode);
    this.sessionList.setSortMode(this.sortMode);
    this.requestRender();
  }

  toggleNameFilter(): void {
    this.nameFilter = this.nameFilter === "all" ? "named" : "all";
    this.header.setNameFilter(this.nameFilter);
    this.sessionList.setNameFilter(this.nameFilter);
    this.requestRender();
  }

  protected refreshSessionsAfterMutation(): Effect.Effect<void> {
    return awaitingWith(
      function* () {
        this.cancelLoads();
        this.currentSessions = null;
        this.allSessions = null;
        yield* performed(this.loadScope(this.scope));
      },
      this as unknown as SessionSelectorComponent,
    );
  }

  toggleScope(): void {
    this.scope = this.scope === "current" ? "all" : "current";
    const sessions = this.scope === "current" ? this.currentSessions : this.allSessions;
    const loading = (this.scope === "current" ? this.currentLoad : this.allLoad) !== null;
    this.header.setScope(this.scope);
    this.header.setLoading(loading);
    this.sessionList.setSessions(sessions ?? [], this.scope === "all");
    this.requestRender();
    if (sessions === null && !loading) void Effect.runFork(this.loadScope(this.scope));
  }

  getSessionList(): SessionList {
    return this.sessionList;
  }
}
