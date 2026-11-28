declare namespace lintProbeTypes {
  interface Diagnostic {
    readonly code: string;
    readonly filename: string;
    readonly help?: string | undefined;
    readonly labels: ReadonlyArray<{ readonly span: { readonly line: number } }>;
  }

  type Diagnostics = ReadonlyArray<Diagnostic>;
}

export type { lintProbeTypes as default };
