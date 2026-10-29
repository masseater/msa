declare namespace inputPatternsTypes {
  type Matcher = (file: string) => boolean;

  interface Rule {
    readonly exclude: boolean;
    readonly test: Matcher;
  }

  type Coverage = { readonly covers: Matcher } | { readonly problem: string };
}

export type { inputPatternsTypes as default };
