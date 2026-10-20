import tuiModule from "@msa/tui";

import config from "../../config.ts";
import type agentSessionTypes from "../../core/agent-session.types.ts";
import httpDispatcher from "../../core/http-dispatcher.ts";
import pathModule from "../path.ts";
import ArminComponent from "./components/armin.ts";
import easterEgg3dLazy from "./components/easter-egg-3d.lazy.ts";
import statusIndicators from "./components/status-indicators.ts";
import InteractiveModeLayer8 from "./interactive-mode-layer-8.ts";
import interactiveModeSupport from "./interactive-mode-support.ts";

const { basename } = pathModule;
const { APP_NAME, APP_TITLE, VERSION, detectInstallChange } = config;
const { Spacer, TuiAltScreen, setCapabilityOverrides } = tuiModule;
const { configureHttpDispatcher } = httpDispatcher;
const { formatResumeCommand } = interactiveModeSupport;
const { BranchSummaryStatusIndicator, CompactionStatusIndicator, RetryStatusIndicator } =
  statusIndicators;
const { playArmin3d } = easterEgg3dLazy;

export default abstract class InteractiveModeLayer9 extends InteractiveModeLayer8 {
  protected updateTerminalTitle(): void {
    const cwdBasename = basename(this.sessionManager.getCwd());
    const sessionName = this.sessionManager.getSessionName();
    if (sessionName !== undefined && sessionName !== "") {
      this.ui.terminal.setTitle(`${APP_TITLE} - ${sessionName} - ${cwdBasename}`);
    } else {
      this.ui.terminal.setTitle(`${APP_TITLE} - ${cwdBasename}`);
    }
  }

  protected applyRuntimeSettings(): void {
    setCapabilityOverrides(this.settingsManager.getTerminalCapabilityOverrides());
    this.ensurePngTranscoder();
    configureHttpDispatcher(this.settingsManager.getHttpIdleTimeoutMs());
    this.applyFullscreenScrollbarSetting();
    if (this.renderer instanceof TuiAltScreen) {
      this.renderer.setCopyOnSelect(this.settingsManager.getFullscreenCopyOnSelect());
      this.renderer.setWheelScrollLines(this.settingsManager.getFullscreenWheelScrollLines());
    }
    this.footer.setSession(this.session);
    this.updateGoalTicker();
    void this.session.integrations.orchestration.orchestrator?.refresh();
    this.footer.setAutoCompactEnabled(this.session.compaction.auto.autoCompactionEnabled);
    this.footerDataProvider.setCwd(this.sessionManager.getCwd());
    this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();
    this.outputPad = this.settingsManager.getOutputPad();
    this.ui.setShowHardwareCursor(this.settingsManager.getShowHardwareCursor());
    const clearOnShrink = this.settingsManager.getClearOnShrink();
    this.ui.setClearOnShrink(clearOnShrink);
    if (!clearOnShrink && this.activeStatusIndicator === undefined) {
      this.statusContainer.clear();
    }
    const editorPaddingX = this.settingsManager.getEditorPaddingX();
    const autocompleteMaxVisible = this.settingsManager.getAutocompleteMaxVisible();
    this.defaultEditor.setPaddingX(editorPaddingX);
    this.defaultEditor.setAutocompleteMaxVisible(autocompleteMaxVisible);
    if (this.editor !== this.defaultEditor) {
      this.editor.setPaddingX?.(editorPaddingX);
      this.editor.setAutocompleteMaxVisible?.(autocompleteMaxVisible);
    }
  }

  protected maybeShowInstallChangeWarning(): boolean {
    if (this.installChangeWarningShown) return true;
    const change = detectInstallChange();
    if (change === undefined) return false;
    this.installChangeWarningShown = true;
    const cause =
      change.kind === "updated"
        ? `${APP_NAME} was updated to ${change.version} while this session was running (${VERSION})`
        : `The ${APP_NAME} installation this session runs from was removed or replaced`;
    const resumeCommand = formatResumeCommand(this.sessionManager);
    const restart =
      resumeCommand !== undefined && resumeCommand !== ""
        ? `Restart with \`${resumeCommand}\` to continue this session.`
        : `Restart ${APP_NAME}.`;
    this.showWarning(
      `${cause}. Features that load code on demand can fail until restart. ${restart}`,
    );
    return true;
  }

  protected onToolExecutionEnd(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "tool_execution_end" }>,
  ): void {
    if (event.isError) this.maybeShowInstallChangeWarning();
    const component = this.pendingTools.get(event.toolCallId);
    if (component === undefined) return;
    component.updateResult({
      ...event.result,
      durationMs: event.durationMs,
      isError: event.isError,
    });
    this.pendingTools.delete(event.toolCallId);
    this.ui.requestRender();
  }

  protected onCompactionStart(reason: "manual" | "overflow" | "threshold"): void {
    if (this.settingsManager.getShowTerminalProgress()) this.ui.terminal.setProgress(true);
    this.autoCompactionEscapeHandler = this.defaultEditor.onEscape;
    this.defaultEditor.onEscape = () => {
      this.session.compaction.manual.abortCompaction();
    };
    this.showStatusIndicator(
      new CompactionStatusIndicator(this.ui, reason, this.compactionStatusColor()),
    );
    this.ui.requestRender();
  }

  protected onAutoRetryEnd(
    event: Extract<agentSessionTypes.AgentSessionEvent, { type: "auto_retry_end" }>,
  ): void {
    if (this.retryEscapeHandler !== undefined) {
      this.defaultEditor.onEscape = this.retryEscapeHandler;
      this.retryEscapeHandler = undefined;
    }
    this.clearStatusIndicator("retry");
    if (!event.success)
      this.showError(
        `Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`,
      );
    this.ui.requestRender();
  }

  protected showRetryStatus(attempt: number, maxAttempts: number, delayMs: number): void {
    this.showStatusIndicator(new RetryStatusIndicator(this.ui, attempt, maxAttempts, delayMs));
    this.ui.requestRender();
  }

  protected onSummarizationAttemptStart(
    event: Extract<
      agentSessionTypes.AgentSessionEvent,
      { type: "summarization_retry_attempt_start" }
    >,
  ): void {
    this.clearStatusIndicator("retry");
    if (event.source === "branchSummary")
      this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
    else
      this.showStatusIndicator(
        new CompactionStatusIndicator(this.ui, event.reason, this.compactionStatusColor()),
      );
    this.ui.requestRender();
  }

  protected showTreeSelectorShowingSummaryIndicator(wantsSummary: boolean): {
    showingSummaryIndicator: boolean;
    originalOnEscape: (() => void) | undefined;
  } {
    let showingSummaryIndicator = false;
    const originalOnEscape = this.defaultEditor.onEscape;

    if (wantsSummary) {
      this.defaultEditor.onEscape = () => {
        this.session.context.tree.abortBranchSummary();
      };
      this.chatContainer.addChild(new Spacer(1));
      this.showStatusIndicator(new BranchSummaryStatusIndicator(this.ui));
      showingSummaryIndicator = true;
      this.ui.requestRender();
    }
    return { originalOnEscape, showingSummaryIndicator };
  }

  protected handleArminSaysHi(): void {
    if (playArmin3d(this.renderer)) return;
    this.chatContainer.addChild(new Spacer(1));
    this.chatContainer.addChild(new ArminComponent(this.ui));
    this.ui.requestRender();
  }
}
