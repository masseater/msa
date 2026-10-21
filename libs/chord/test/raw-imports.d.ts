declare module "*?raw" {
  const text: string;
  export default text;
}

interface ImportMeta {
  glob<T>(
    patterns: readonly string[],
    options: { readonly eager: true; readonly import: "default"; readonly query: "?raw" },
  ): Record<string, T>;
}
