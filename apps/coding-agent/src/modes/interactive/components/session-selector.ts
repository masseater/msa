import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";

import KeybindingsManager from "../../../core/keybindings-manager.ts";
import type keybindingsTypes from "../../../core/keybindings.types.ts";
import type sessionManagerTypes from "../../../core/session-manager.types.ts";
import errors from "../../../utils/errors.ts";
import SessionList from "./session-list.ts";
import SessionSelectorHeader from "./session-selector-header.ts";
import type sessionSelectorInternalTypes from "./session-selector-internal.types.ts";
import SessionSelectorComponentLayer2 from "./session-selector-layer-2.ts";

const { toErrorMessage } = errors;

export default class SessionSelectorComponent
  extends SessionSelectorComponentLayer2
  implements tuiTypes.Focusable
{
  static buildClearStatusMessage(
    self: SessionSelectorComponent,
    onSelect: (sessionPath: string) => void,
    onCancel: () => void,
  ): () => void {
    self.buildBaseLayout(self.sessionList);

    self.renameInput.onSubmit = (value) => {
      void Effect.runFork(self.confirmRename(value));
    };

    const clearStatusMessage = () => self.header.setStatusMessage(null);
    self.sessionList.onSelect = (sessionPath) => {
      clearStatusMessage();
      self.cancelLoads();
      onSelect(sessionPath);
    };
    self.sessionList.onCancel = () => {
      clearStatusMessage();
      self.cancelLoads();
      onCancel();
    };
    return clearStatusMessage;
  }

  static buildPart2(
    self: SessionSelectorComponent,
    clearStatusMessage: () => void,
    onExit: () => void,
    renameSession:
      | ((sessionPath: string, currentName: string | undefined) => Promise<void>)
      | undefined,
  ): void {
    self.sessionList.onExit = () => {
      clearStatusMessage();
      self.cancelLoads();
      onExit();
    };
    self.sessionList.onToggleScope = () => self.toggleScope();
    self.sessionList.onToggleSort = () => self.toggleSortMode();
    self.sessionList.onToggleNameFilter = () => self.toggleNameFilter();
    self.sessionList.onRenameSession = (sessionPath) => {
      if (renameSession === undefined) return;
      if ((self.scope === "current" ? self.currentLoad : self.allLoad) !== null) return;

      const sessions =
        self.scope === "all" ? (self.allSessions ?? []) : (self.currentSessions ?? []);
      const session = sessions.find((s) => s.path === sessionPath);
      self.enterRenameMode(sessionPath, session?.name);
    };

    self.sessionList.onTogglePath = (showPath) => {
      self.header.setShowPath(showPath);
      self.requestRender();
    };
    self.sessionList.onDeleteConfirmationChange = (path) => {
      self.header.setConfirmingDeletePath(path);
      self.requestRender();
    };
    self.sessionList.onError = (msg) => {
      self.header.setStatusMessage({ message: msg, type: "error" }, 3000);
      self.requestRender();
    };
  }

  static loadScopeOnProgress(
    self: SessionSelectorComponent,
    scope: sessionSelectorInternalTypes.SessionScope,
  ): {
    onProgress: sessionManagerTypes.SessionListProgress;
    controller: AbortController;
    isActive: () => boolean;
    showCwd: boolean;
  } {
    const showCwd = scope === "all";
    const controller = new AbortController();
    if (scope === "current") {
      self.currentLoad = controller;
    } else {
      self.allLoad = controller;
    }
    self.header.setScope(scope);
    self.header.setLoading(true);
    self.requestRender();

    const isActive = () => (scope === "current" ? self.currentLoad : self.allLoad) === controller;
    const onProgress: sessionManagerTypes.SessionListProgress = (
      loaded,
      total,
      partialSessions,
    ) => {
      if (!isActive()) return;
      if (partialSessions !== undefined) {
        const sessions = [...partialSessions];
        if (scope === "current") {
          self.currentSessions = sessions;
        } else {
          self.allSessions = sessions;
        }
        if (scope === self.scope) self.sessionList.setSessions(sessions, showCwd);
      }
      if (scope !== self.scope) return;
      self.header.setProgress(loaded, total);
      self.requestRender();
    };
    return { controller, isActive, onProgress, showCwd };
  }

  static loadScopePart2(self: SessionSelectorComponent, err: unknown, showCwd: boolean): void {
    const message = toErrorMessage(err);
    self.header.setLoading(false);
    self.header.setStatusMessage(
      { message: `Failed to load sessions: ${message}`, type: "error" },
      4000,
    );
    self.sessionList.setSessions([], showCwd);
    self.requestRender();
  }

  constructor(
    currentSessionsLoader: sessionSelectorInternalTypes.SessionsLoader,
    allSessionsLoader: sessionSelectorInternalTypes.SessionsLoader,
    onSelect: (sessionPath: string) => void,
    onCancel: () => void,
    onExit: () => void,
    requestRender: () => void,
    options?: {
      renameSession?: (sessionPath: string, currentName: string | undefined) => Promise<void>;
      showRenameHint?: boolean;
      keybindings?: keybindingsTypes.KeybindingsManager;
    },
    currentSessionFilePath?: string,
  ) {
    super();
    this.keybindings = options?.keybindings ?? KeybindingsManager.create();
    this.currentSessionsLoader = currentSessionsLoader;
    this.allSessionsLoader = allSessionsLoader;
    this.requestRender = requestRender;
    this.header = new SessionSelectorHeader(
      this.scope,
      this.sortMode,
      this.nameFilter,
      this.requestRender,
    );
    const renameSession = options?.renameSession;
    this.renameSession = renameSession;
    this.canRename = renameSession !== undefined;
    this.header.setShowRenameHint(options?.showRenameHint ?? this.canRename);

    this.sessionList = new SessionList(
      [],
      false,
      this.sortMode,
      this.nameFilter,
      this.keybindings,
      currentSessionFilePath,
    );

    const clearStatusMessage = SessionSelectorComponent.buildClearStatusMessage(
      this,
      onSelect,
      onCancel,
    );
    SessionSelectorComponent.buildPart2(this, clearStatusMessage, onExit, renameSession);

    this.constructPart1();
  }
}
