declare namespace sourceInfoTypes {
  type SourceScope = "user" | "project" | "temporary";

  type SourceOrigin = "package" | "top-level";

  interface SourceInfo {
    path: string;
    source: string;
    scope: SourceScope;
    origin: SourceOrigin;
    baseDir?: string | undefined;
  }
}

export type { sourceInfoTypes as default };
