declare namespace lazyTypes {
  interface LazyApiCapabilities {
    fetchDeferred?: boolean;
    cancelDeferred?: boolean;
    countTokens?: boolean;
  }
}

export type { lazyTypes as default };
