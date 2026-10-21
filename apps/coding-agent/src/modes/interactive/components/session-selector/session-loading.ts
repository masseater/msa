import { Effect } from "effect";

import awaitingModule from "../../../../core/awaiting.ts";
import type sessionManagerTypes from "../../../../core/session-manager.types.ts";
import errors from "../../../../utils/errors.ts";
import type sessionSelectorInternalTypes from "../session-selector-internal.types.ts";
import type SessionSelectorComponent from "../session-selector.ts";

const { awaited, awaitingWith, performed } = awaitingModule;
const { toErrorMessage } = errors;

export default class SessionLoading {
  private readonly selector: SessionSelectorComponent;

  currentSessions: sessionManagerTypes.SessionInfo[] | null = null;

  allSessions: sessionManagerTypes.SessionInfo[] | null = null;

  currentSessionsLoader!: sessionSelectorInternalTypes.SessionsLoader;

  allSessionsLoader!: sessionSelectorInternalTypes.SessionsLoader;

  currentLoad: AbortController | null = null;

  allLoad: AbortController | null = null;

  constructor(selector: SessionSelectorComponent) {
    this.selector = selector;
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

  loadScope(scope: sessionSelectorInternalTypes.SessionScope): Effect.Effect<void> {
    return awaitingWith(function* () {
      if ((scope === "current" ? this.loading.currentLoad : this.loading.allLoad) !== null) return;

      const { onProgress, controller, isActive, showCwd } = this.loading.startLoad(scope);

      try {
        const sessions = yield* awaited(
          scope === "current"
            ? this.loading.currentSessionsLoader(onProgress, controller.signal)
            : this.loading.allSessionsLoader(onProgress, controller.signal),
        );
        if (!isActive()) return;

        if (scope === "current") {
          this.loading.currentSessions = sessions;
          this.loading.currentLoad = null;
        } else {
          this.loading.allSessions = sessions;
          this.loading.allLoad = null;
        }

        if (scope !== this.scope) return;
        this.header.setLoading(false);
        this.sessionList.setSessions(sessions, showCwd);
        this.requestRender();
      } catch (err) {
        if (!isActive()) return;
        if (scope === "current") {
          this.loading.currentLoad = null;
          this.loading.currentSessions = null;
        } else {
          this.loading.allLoad = null;
          this.loading.allSessions = null;
        }
        if (scope !== this.scope) return;

        this.loading.showLoadError(err, showCwd);
      }
    }, this.selector);
  }

  refreshSessionsAfterMutation(): Effect.Effect<void> {
    return awaitingWith(function* () {
      this.loading.cancelLoads();
      this.loading.currentSessions = null;
      this.loading.allSessions = null;
      yield* performed(this.loading.loadScope(this.scope));
    }, this.selector);
  }

  toggleScope(): void {
    this.selector.scope = this.selector.scope === "current" ? "all" : "current";
    const sessions = this.selector.scope === "current" ? this.currentSessions : this.allSessions;
    const loading = (this.selector.scope === "current" ? this.currentLoad : this.allLoad) !== null;
    this.selector.header.setScope(this.selector.scope);
    this.selector.header.setLoading(loading);
    this.selector.sessionList.setSessions(sessions ?? [], this.selector.scope === "all");
    this.selector.requestRender();
    if (sessions === null && !loading) void Effect.runFork(this.loadScope(this.selector.scope));
  }

  startLoad(scope: sessionSelectorInternalTypes.SessionScope): {
    onProgress: sessionManagerTypes.SessionListProgress;
    controller: AbortController;
    isActive: () => boolean;
    showCwd: boolean;
  } {
    const showCwd = scope === "all";
    const controller = new AbortController();
    if (scope === "current") {
      this.currentLoad = controller;
    } else {
      this.allLoad = controller;
    }
    this.selector.header.setScope(scope);
    this.selector.header.setLoading(true);
    this.selector.requestRender();

    const isActive = () => (scope === "current" ? this.currentLoad : this.allLoad) === controller;
    const onProgress: sessionManagerTypes.SessionListProgress = (
      loaded,
      total,
      partialSessions,
    ) => {
      if (!isActive()) return;
      if (partialSessions !== undefined) {
        const sessions = [...partialSessions];
        if (scope === "current") {
          this.currentSessions = sessions;
        } else {
          this.allSessions = sessions;
        }
        if (scope === this.selector.scope) this.selector.sessionList.setSessions(sessions, showCwd);
      }
      if (scope !== this.selector.scope) return;
      this.selector.header.setProgress(loaded, total);
      this.selector.requestRender();
    };
    return { controller, isActive, onProgress, showCwd };
  }

  showLoadError(err: unknown, showCwd: boolean): void {
    const message = toErrorMessage(err);
    this.selector.header.setLoading(false);
    this.selector.header.setStatusMessage(
      { message: `Failed to load sessions: ${message}`, type: "error" },
      4000,
    );
    this.selector.sessionList.setSessions([], showCwd);
    this.selector.requestRender();
  }
}
