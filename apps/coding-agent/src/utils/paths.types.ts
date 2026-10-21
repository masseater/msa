declare namespace pathsTypes {
  interface PathInputOptions {
    trim?: boolean;

    expandTilde?: boolean;

    homeDir?: string;

    stripAtPrefix?: boolean;

    normalizeUnicodeSpaces?: boolean;
  }
}

export type { pathsTypes as default };
