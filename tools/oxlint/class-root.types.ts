import type { Context } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";

declare namespace classRootTypes {
  type Walk = { readonly context: Context; readonly selfSpecifiers: readonly string[] };

  type Root = {
    readonly base: string | undefined;
    readonly path: readonly string[];
    readonly references: readonly flowTypes.Node[];
  };
}

export type { classRootTypes as default };
