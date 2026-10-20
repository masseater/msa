import tuiModule from "@msa/tui";

import type agentSessionTypes from "../../../core/agent-session.types.ts";
import statusIndicators from "../components/status-indicators.ts";
import ThemedText from "../components/themed-text.ts";
import type InteractiveMode from "../interactive-mode.ts";
import themeModule from "../theme/theme.ts";

const { BranchSummaryStatusIndicator, CompactionStatusIndicator, RetryStatusIndicator } =
  statusIndicators;
const { theme } = themeModule;
const { Spacer } = tuiModule;

export default class OperationStatusEvents {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  private autoCompactionEscapeHandler?: (() => void) | undefined;

  retryEscapeHandler?: (() => void) | undefined;

  private endCompactionStatus(): void {
    if (this.mode.settingsManager.getShowTerminalProgress()) {
      this.mode.ui.terminal.setProgress(false);
    }
    if (this.autoCompactionEscapeHandler !== undefined) {
      this.mode.defaultEditor.onEscape = this.autoCompactionEscapeHandler;
      this.autoCompactionEscapeHandler = undefined;
    }
    this.mode.display.indicator.clearStatusIndicator("compaction");
  }

  onCompactionStart(reason: "manual" | "overflow" | "threshold"): void {
    if (this.mode.settingsManager.getShowTerminalProgress())
      this.mode.ui.terminal.setProgress(true);
    this.autoCompactionEscapeHandler = this.mode.defaultEditor.onEscape;
    this.mode.defaultEditor.onEscape = () => {
      this.mode.session.compaction.manual.abortCompaction();
    };
    this.mode.display.indicator.showStatusIndicator(
      new CompactionStatusIndicator(
        this.mode.ui,
        reason,
        this.mode.display.indicator.compactionStatusColor(),
      ),
    );
    this.mode.ui.requestRender();
  }

  onAutoRetryEnd(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "auto_retry_end" }>,
  ): void {
    if (this.retryEscapeHandler !== undefined) {
      this.mode.defaultEditor.onEscape = this.retryEscapeHandler;
      this.retryEscapeHandler = undefined;
    }
    this.mode.display.indicator.clearStatusIndicator("retry");
    if (!event.success)
      this.mode.display.status.showError(
        `Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
      );
    this.mode.ui.requestRender();
  }

  showRetryStatus(attempt: number, maxAttempts: number, delayMs: number): void {
    this.mode.display.indicator.showStatusIndicator(
      new RetryStatusIndicator(this.mode.ui, attempt, maxAttempts, delayMs),
    );
    this.mode.ui.requestRender();
  }

  onSummarizationAttemptStart(
    event: Extract<
      agentSessionTypes.AgentSessionEvent,
      { type: "summarization_retry_attempt_start" }
    >,
  ): void {
    this.mode.display.indicator.clearStatusIndicator("retry");
    if (event.source === "branchSummary")
      this.mode.display.indicator.showStatusIndicator(
        new BranchSummaryStatusIndicator(this.mode.ui),
      );
    else
      this.mode.display.indicator.showStatusIndicator(
        new CompactionStatusIndicator(
          this.mode.ui,
          event.reason,
          this.mode.display.indicator.compactionStatusColor(),
        ),
      );
    this.mode.ui.requestRender();
  }

  onCompactionEnd(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "compaction_end" }>,
  ): void {
    this.endCompactionStatus();
    if (event.aborted) {
      if (event.reason === "manual") this.mode.display.status.showError("Compaction cancelled");
      else this.mode.display.status.showStatus("Auto-compaction cancelled");
    } else if (event.result !== undefined) {
      this.mode.view.history.renderCompactedSession(event.result);
    } else if (event.errorMessage !== undefined && event.errorMessage !== "") {
      const errorMessage = event.errorMessage;
      if (event.reason === "manual") this.mode.display.status.showError(errorMessage);
      else {
        this.mode.layout.chatContainer.addChild(new Spacer(1));
        this.mode.layout.chatContainer.addChild(
          new ThemedText(() => theme.fg("error", errorMessage), 1, 0),
        );
      }
    }
    void this.mode.input.queue.flushCompactionQueue({ willRetry: event.willRetry });
    this.mode.ui.requestRender();
  }
}
