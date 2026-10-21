import tuiModule from "@msa/tui";
import { Effect } from "effect";

import config from "../../../config.ts";
import type agentSessionTypes from "../../../core/agent-session.types.ts";
import awaitingModule from "../../../core/awaiting.ts";
import platformModule from "../../../core/platform/index.ts";
import type platformTypes from "../../../core/platform/index.types.ts";
import interval from "../../interval.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";
const { theme } = themeModule;
const { APP_NAME, APP_TITLE } = config;
const { formatAttentionAlert } = tuiModule;

const firstLine = (text: string): string => text.split(/\r?\n/u, 1)[0]?.trim() ?? "";
const { every } = interval;
const { awaited, awaitingWith, performed } = awaitingModule;
const { basename } = platformModule;

export default class SessionEventRouter {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  goalTicker!: platformTypes.Scheduled | undefined;

  unsubscribe?: (() => void) | undefined;

  updateGoalTicker(): void {
    if (this.mode.session.integrations.goal.goal !== undefined) {
      this.goalTicker ??= every(() => this.mode.ui.requestRender(), 1000);
    } else if (this.goalTicker !== undefined) {
      this.goalTicker.cancel();
      this.goalTicker = undefined;
    }
  }

  updateTerminalTitle(): void {
    const cwdBasename = basename(this.mode.sessionManager.getCwd());
    const sessionName = this.mode.sessionManager.getSessionName();
    const app =
      this.mode.session.run.fallback.stalled === undefined ? APP_TITLE : `${APP_TITLE} (stopped)`;
    if (sessionName !== undefined && sessionName !== "") {
      this.mode.ui.terminal.setTitle(`${app} - ${sessionName} - ${cwdBasename}`);
    } else {
      this.mode.ui.terminal.setTitle(`${app} - ${cwdBasename}`);
    }
  }

  private handleProviderEvent(event: agentSessionTypes.AgentSessionEvent): boolean {
    switch (event.type) {
      case "model_fallback":
        this.mode.display.status.showWarning(
          `${event.from} failed (${firstLine(event.errorMessage)}). Switched to ${event.to}.`,
        );
        return true;
      case "provider_stalled": {
        const message = `${event.model} stopped: ${firstLine(event.errorMessage)}`;
        this.mode.ui.terminal.write(formatAttentionAlert(APP_NAME, message));
        this.mode.layout.programStatus.setBlocked("provider", { kind: "auth", message });
        this.updateTerminalTitle();
        return true;
      }
      case "provider_recovered":
        this.mode.layout.programStatus.setBlocked("provider", undefined);
        this.updateTerminalTitle();
        return true;
      default:
        return false;
    }
  }

  private handleViewRefreshEvent(event: agentSessionTypes.AgentSessionEvent): void {
    switch (event.type) {
      case "queue_update":
        this.mode.input.queue.updatePendingMessagesDisplay();
        break;
      case "session_info_changed":
        this.updateTerminalTitle();
        this.mode.footer.invalidate();
        break;
      case "thinking_level_changed":
        this.mode.footer.invalidate();
        this.mode.input.keys.updateEditorBorderColor();
        return;
      case "summarization_retry_finished":
        this.mode.display.indicator.clearStatusIndicator("retry");
        break;
      case "goal_changed":
        this.updateGoalTicker();
        break;
      case "orchestrator_changed":
      case "pr_watch_changed":
        this.mode.footer.invalidate();
        break;
      default:
        return;
    }
    this.mode.ui.requestRender();
  }

  private handleSessionEvent(event: agentSessionTypes.AgentSessionEvent): Effect.Effect<void> {
    return awaitingWith(function* () {
      switch (event.type) {
        case "entry_appended":
          return this.mode.view.history.onEntryAppended(event.entry);
        case "agent_settled":
          return yield* performed(this.mode.lifecycle.shutdown.checkShutdownRequested());
        case "compaction_start":
          return this.mode.display.operationStatus.onCompactionStart(event.reason);
        case "compaction_end":
          return this.mode.display.operationStatus.onCompactionEnd(event);
        case "auto_retry_start":
          this.mode.display.operationStatus.retryEscapeHandler = this.mode.defaultEditor.onEscape;
          this.mode.defaultEditor.onEscape = () => {
            this.mode.session.run.retry.abortRetry();
          };
          return this.mode.display.operationStatus.showRetryStatus(
            event.attempt,
            event.maxAttempts,
            event.delayMs,
          );
        case "auto_retry_end":
          return this.mode.display.operationStatus.onAutoRetryEnd(event);
        case "summarization_retry_scheduled":
          this.mode.display.status.showError(event.errorMessage);
          return this.mode.display.operationStatus.showRetryStatus(
            event.attempt,
            event.maxAttempts,
            event.delayMs,
          );
        case "summarization_retry_attempt_start":
          return this.mode.display.operationStatus.onSummarizationAttemptStart(event);
        case "goal_status":
          return this.mode.view.panels.onGoalStatus(event.goal);
        case "memory_status":
          return this.mode.view.panels.addMutedLines(() =>
            event.text
              .split("\n")
              .map((line) => theme.fg("muted", line))
              .join("\n"),
          );
        default:
          return this.handleViewRefreshEvent(event);
      }
    }, this);
  }

  subscribeToAgent(): void {
    this.unsubscribe = this.mode.session.subscribe((event) =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(this.handleEvent(event));
        }, this),
      ),
    );
  }

  handleEvent(event: agentSessionTypes.AgentSessionEvent): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (!this.mode.lifecycle.startup.isInitialized)
          yield* awaited(this.mode.lifecycle.startup.init());
        this.mode.footer.invalidate();
        this.mode.layout.programStatus.handleEvent(event);
        if (this.handleProviderEvent(event)) return;
        if (this.mode.view.streaming.handleStreamEvent(event)) return;
        yield* performed(this.handleSessionEvent(event));
      }, this),
    );
  }
}
