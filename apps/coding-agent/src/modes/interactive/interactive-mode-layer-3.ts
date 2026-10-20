import type tuiTypes from "@msa/tui/index.types";

import type bashExecutionTypes from "./components/bash-execution.types.ts";
import type extensionDialogsTypes from "./extension-dialogs.types.ts";
import type extensionWidgetsTypes from "./extension-widgets.types.ts";
import type interactiveModeInternalTypes from "./interactive-mode-internal.types.ts";
import InteractiveModeLayer2 from "./interactive-mode-layer-2.ts";
import type interactiveModeTypes from "./interactive-mode.types.ts";
import ProgramStatusReporter from "./program-status-reporter.ts";
import type themeControllerTypes from "./theme/theme-controller.types.ts";

export default abstract class InteractiveModeLayer3 extends InteractiveModeLayer2 {
  protected bashComponent: bashExecutionTypes.BashExecutionComponent | undefined = undefined;
  protected pendingBashComponents: bashExecutionTypes.BashExecutionComponent[] = [];
  protected autoCompactionEscapeHandler?: (() => void) | undefined;
  protected retryEscapeHandler?: (() => void) | undefined;
  protected compactionQueuedMessages: interactiveModeInternalTypes.CompactionQueuedMessage[] = [];
  protected shutdownRequested = false;
  protected readonly programStatus = new ProgramStatusReporter(
    () => this.ui.terminal,
    () => this.sessionManager.getSessionName(),
  );
  protected bugReportHintShown = false;
  protected installChangeWarningShown = false;
  protected extensionDialogs!: extensionDialogsTypes.ExtensionDialogs;
  protected extensionTerminalInputSubscriptions = new Set<{
    handler: (data: string) => { consume?: boolean; data?: string } | undefined;
    unsubscribe: () => void;
  }>();
  protected extensionWidgets!: extensionWidgetsTypes.ExtensionWidgets;
  protected customFooter: (tuiTypes.Component & { dispose?(): void }) | undefined = undefined;
  protected headerContainer!: tuiTypes.Container;
  protected builtInHeader: tuiTypes.Component | undefined = undefined;
  protected customHeader: (tuiTypes.Component & { dispose?(): void }) | undefined = undefined;
  protected options!: interactiveModeTypes.InteractiveModeOptions;
  protected autoTrustOnReloadCwd!: string | undefined;
  protected themeController!: themeControllerTypes.InteractiveThemeController;
  protected isShuttingDown = false;
}
