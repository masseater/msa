import type McpServerLogClass from "./log.ts";

declare namespace logTypes {
  type McpServerLog = (typeof McpServerLogClass)["prototype"];
}

export type { logTypes as default };
