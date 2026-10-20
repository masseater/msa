declare namespace readRangeTypes {
  interface RangeRead {
    readonly read: (offset: number, length: number) => Promise<Uint8Array>;
    readonly offset: number;
    readonly length: number;
    readonly chunk: number;
    readonly aborted: () => boolean;
  }
}

export type { readRangeTypes as default };
