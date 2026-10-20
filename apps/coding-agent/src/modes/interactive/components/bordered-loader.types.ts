import type BorderedLoaderClass from "./bordered-loader.ts";

declare namespace borderedLoaderTypes {
  type BorderedLoader = (typeof BorderedLoaderClass)["prototype"];
}

export type { borderedLoaderTypes as default };
