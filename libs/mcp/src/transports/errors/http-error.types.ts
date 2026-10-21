import type McpHttpErrorClass from "./http-error.ts";

declare namespace httpErrorTypes {
  type McpHttpError = McpHttpErrorClass;
}

export type { httpErrorTypes as default };
