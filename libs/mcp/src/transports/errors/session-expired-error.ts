import { McpHttpError } from "./http-error.ts";

export class McpSessionExpiredError extends McpHttpError {
  override readonly name = "McpSessionExpiredError";

  constructor(body = "") {
    super(404, "MCP session expired", body);
  }
}
