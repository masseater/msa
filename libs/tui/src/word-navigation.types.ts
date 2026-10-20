declare namespace wordNavigationTypes {
  interface WordNavigationOptions {
    segment?: (text: string) => Iterable<Intl.SegmentData>;
    isAtomicSegment?: (segment: string) => boolean;
  }
}

export type { wordNavigationTypes as default };
