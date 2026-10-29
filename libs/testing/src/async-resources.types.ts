declare namespace asyncResourcesTypes {
  interface ChildProcessTracker {
    readonly running: () => boolean;
  }
}

export type { asyncResourcesTypes as default };
