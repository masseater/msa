declare namespace sessionWatchesSupportTypes {
  type State = { value: number; items: string[]; retained: { label: string } };

  type Deferred = { readonly promise: Promise<void>; readonly resolve: () => void };
}

export type { sessionWatchesSupportTypes as default };
