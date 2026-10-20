import McpHttpError from "./http-error.ts";

export default class McpSessionExpiredError extends McpHttpError {
  override readonly name = "McpSessionExpiredError";

  constructor(body = "") {
    super(404, "MCP session expired", body);
  }
}
