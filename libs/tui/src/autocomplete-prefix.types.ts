declare namespace autocompletePrefixTypes {
  interface ParsedPathPrefix {
    rawPrefix: string;
    isAtPrefix: boolean;
    isQuotedPrefix: boolean;
  }

  interface CompletionValueInput {
    path: string;
    isAtPrefix: boolean;
    isQuotedPrefix: boolean;
  }
}

export type { autocompletePrefixTypes as default };
