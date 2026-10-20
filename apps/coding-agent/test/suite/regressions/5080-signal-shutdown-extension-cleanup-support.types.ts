import type SignalShutdownExtensionCleanupSupport from "./5080-signal-shutdown-extension-cleanup-support.ts";

declare namespace SignalShutdownExtensionCleanupSupportTypes {
  type HandlerContext = {
    isShuttingDown: boolean;
    signalCleanupHandlers: Array<() => void>;
    shutdown: () => Promise<void>;
    unregisterSignalHandlers: () => void;
    emergencyTerminalExit: () => never;
    uncaughtCrash: (error: Error) => never;
    recordCrash: () => boolean;
    getCrashExtensionHint: () => string | undefined;
    crashReportInstructions: () => string;
    ui: { stop: () => void };
  };

  type ProcessExitError =
    (typeof SignalShutdownExtensionCleanupSupport.ProcessExitError)["prototype"];
}

export type { SignalShutdownExtensionCleanupSupportTypes as default };
