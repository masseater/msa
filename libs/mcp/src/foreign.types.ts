import type foreignModule from "./foreign.ts";

declare namespace foreignTypes {
  type McpForeignError = (typeof foreignModule.McpForeignError)["prototype"];
}

export type { foreignTypes as default };
