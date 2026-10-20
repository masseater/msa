import type LoaderClass from "./loader.ts";

declare namespace loaderTypes {
  interface LoaderIndicatorOptions {
    frames?: string[];
    intervalMs?: number;
  }

  type Loader = LoaderClass;
}

export type { loaderTypes as default };
