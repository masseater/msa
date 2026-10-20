declare namespace platformTypes {
  interface Scheduled {
    readonly cancel: () => void;
  }

  interface Latch {
    readonly promise: Promise<void>;
    readonly open: () => void;
  }
}

export type { platformTypes as default };
