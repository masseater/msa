declare namespace effectSupportTypes {
  interface DeferredPromise<A> {
    readonly promise: Promise<A>;
    readonly resolve: (value: A) => void;
    readonly reject: (error: unknown) => void;
  }

  interface Gate extends Promise<void> {
    readonly release: () => void;
  }
}

export type { effectSupportTypes as default };
