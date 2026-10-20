declare namespace progressTypes {
  interface Progress {
    mark(): void;
    markAndWait(): Promise<void>;
    stop(): Promise<PromiseWithResolvers<void>[]>;
  }
}

export type { progressTypes as default };
