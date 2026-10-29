import type ciHistoryTypes from "./ci-history.types.ts";
import type ghTypes from "./gh.types.ts";
import type snapshotTypes from "./snapshot.types.ts";

declare namespace watchTypes {
  type CiConclusion = "passed" | "failed" | "cancelled";

  interface PrNotification {
    readonly label: string;
    readonly text: string;
    readonly wake: boolean;

    readonly ci?: { readonly durationMs: number; readonly conclusion: CiConclusion };
  }

  interface PrWatchHost {
    notify: (notification: PrNotification) => void;
    changed: () => void;
  }

  type PrWatchStatus = "watching" | "stopped";

  interface PrWatchEntry {
    readonly target: snapshotTypes.PrWatchTarget;
    readonly key: string;
    readonly label: string;
    readonly baseIntervalMs: number;
    readonly statusIntervalMs: number;
    intervalMs: number;
    status: PrWatchStatus;
    snapshot: snapshotTypes.PrSnapshot | undefined;
    lastNotification: PrNotification | undefined;
    error: string | undefined;
    notifiedError: string | undefined;
    polls: number;
    startedAt: number | undefined;
    lastNotificationAt: number | undefined;
    pendingSince: number | undefined;
    ciHistory: ciHistoryTypes.CiHistory | undefined;
    baseMovedAt: number | undefined;
  }

  interface PrWatchLoopOptions {
    readonly gh: ghTypes.PrWatchGh;
    readonly entry: PrWatchEntry;
    readonly host: PrWatchHost;
  }
}

export type { watchTypes as default };
