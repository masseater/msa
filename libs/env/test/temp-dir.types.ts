declare namespace tempDirTypes {
  interface TempDirUse {
    readonly prefix: string;
    readonly use: (directory: string) => Promise<void>;
  }
}

export type { tempDirTypes as default };
