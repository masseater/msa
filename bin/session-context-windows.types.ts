declare namespace sessionContextWindowsTypes {
  interface ContextWindows {
    readonly sources: ReadonlyArray<string>;
    readonly windows: Map<string, number>;
  }
}

export type { sessionContextWindowsTypes as default };
