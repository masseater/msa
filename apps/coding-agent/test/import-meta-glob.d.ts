interface ImportMeta {
  glob(patterns: readonly string[], options: { readonly eager: true }): Record<string, unknown>;
}
