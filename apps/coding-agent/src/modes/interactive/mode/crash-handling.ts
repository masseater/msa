import config from "../../../config.ts";
import crashLog from "../../../core/crash-log.ts";
import platformModule from "../../../core/platform.ts";
import shell from "../../../utils/shell.ts";
import interactiveModeHelpers from "../interactive-mode-helpers.ts";
import interactiveModeSupport from "../interactive-mode-support.ts";
import type InteractiveMode from "../interactive-mode.ts";
const { APP_NAME } = config;
const { killTrackedDetachedChildren } = shell;
const { isDeadTerminalError } = interactiveModeHelpers;
const { formatCrashExtensionHint } = interactiveModeSupport;
const { findExtensionStackMatches, recordCrash } = crashLog;
const { writeError } = platformModule;

export default class CrashHandling {
  private readonly mode: InteractiveMode;

  constructor(mode: InteractiveMode) {
    this.mode = mode;
  }

  crashReportInstructions(): string {
    const resume =
      this.mode.session.sessionFile !== undefined && this.mode.session.sessionFile !== ""
        ? `run \`${APP_NAME} -r\` to resume the session, then`
        : "start msa and";
    return `To report this crash: ${resume} run /bug. The crash details are attached automatically.`;
  }

  getCrashExtensionHint(error: unknown): string | undefined {
    try {
      return formatCrashExtensionHint(
        findExtensionStackMatches(
          error instanceof Error ? error.stack : undefined,
          this.mode.session.resourceLoader.getExtensions().extensions,
        ),
      );
    } catch {
      return undefined;
    }
  }

  recordCrash(kind: "uncaught_exception" | "fatal_error", error: unknown): boolean {
    try {
      return (
        recordCrash({
          cwd: this.mode.session.sessionManager.getCwd(),
          error,
          kind,
          sessionFile: this.mode.session.sessionFile,
        }) !== undefined
      );
    } catch {
      return false;
    }
  }

  uncaughtCrash(error: Error): never {
    if (isDeadTerminalError(error)) {
      this.mode.lifecycle.shutdown.emergencyTerminalExit();
    }
    if (this.mode.lifecycle.shutdown.isShuttingDown) {
      process.exit(1);
    }
    this.mode.lifecycle.shutdown.isShuttingDown = true;
    try {
      this.mode.lifecycle.shutdown.unregisterSignalHandlers();
    } catch {}
    try {
      killTrackedDetachedChildren();
    } catch {}
    try {
      this.mode.ui.stop();
    } catch {}
    writeError(`${APP_NAME} exiting due to uncaughtException:`);
    writeError(error);
    const extensionHint = this.getCrashExtensionHint(error);
    if (extensionHint !== undefined && extensionHint !== "") writeError(`\n${extensionHint}`);
    if (this.recordCrash("uncaught_exception", error)) {
      writeError(`\n${this.crashReportInstructions()}`);
    }
    process.exit(1);
  }
}
