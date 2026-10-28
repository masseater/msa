import McpHttpError from "./http-error.ts";

export default class McpSessionExpiredError extends McpHttpError.extend<McpSessionExpiredError>(
  "McpSessionExpiredError",
)({}) {
  override readonly name = "McpSessionExpiredError";

  static create(body = ""): McpSessionExpiredError {
    return McpSessionExpiredError.make({ body, message: "MCP session expired", status: 404 });
  }
}
