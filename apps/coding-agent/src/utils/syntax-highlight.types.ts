declare namespace syntaxHighlightTypes {
  type HighlightFormatter = (text: string) => string;

  type HighlightTheme = Partial<Record<string, HighlightFormatter>>;

  interface HighlightOptions {
    language?: string;
    ignoreIllegals?: boolean;
    languageSubset?: string[];
    theme?: HighlightTheme;
  }
}

export type { syntaxHighlightTypes as default };
