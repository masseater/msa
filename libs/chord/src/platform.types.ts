declare namespace platformTypes {
  interface EntryInfo {
    readonly directory: boolean;
    readonly uid: number | undefined;
    readonly mode: number;
  }
}

export type { platformTypes as default };
