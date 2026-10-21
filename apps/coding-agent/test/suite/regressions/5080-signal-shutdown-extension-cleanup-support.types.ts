import type ProcessExitErrorClass from "./5080-signal-shutdown-extension-cleanup-support.ts";

declare namespace SignalShutdownExtensionCleanupSupportTypes {
  type HandlerContext = {
    isShuttingDown: boolean;
    signalCleanupHandlers: Array<() => void>;
    shutdown: () => Promise<void>;
    recordCrash: () => boolean;
    getCrashExtensionHint: () => string | undefined;
    crashReportInstructions: () => string;
    ui: { stop: () => void };
  };

  type ProcessExitError = (typeof ProcessExitErrorClass)["prototype"];
}

export type { SignalShutdownExtensionCleanupSupportTypes as default };
