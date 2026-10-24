import { Schema } from "effect";

import McpHttpError from "./http-error.ts";

export default class McpAuthRequiredError extends McpHttpError.extend<McpAuthRequiredError>(
  "McpAuthRequiredError",
)({ wwwAuthenticate: Schema.NullOr(Schema.String) }) {
  override readonly name = "McpAuthRequiredError";

  static create(response: Response, body = ""): McpAuthRequiredError {
    return McpAuthRequiredError.make({
      body,
      message: "MCP server requires authentication",
      status: 401,
      wwwAuthenticate: response.headers.get("www-authenticate"),
    });
  }
}
