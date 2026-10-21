import type esbuildFilter from "./esbuild-filter.ts";

declare namespace esbuildFilterTypes {
  type EsbuildFilter = (typeof esbuildFilter.EsbuildFilter)["prototype"];
}

export type { esbuildFilterTypes as default };
