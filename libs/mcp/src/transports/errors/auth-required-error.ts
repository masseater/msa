import { McpHttpError } from "./http-error.ts";

export class McpAuthRequiredError extends McpHttpError {
  override readonly name = "McpAuthRequiredError";
  readonly wwwAuthenticate: string | null;

  constructor(response: Response, body = "") {
    super(401, "MCP server requires authentication", body);
    this.wwwAuthenticate = response.headers.get("www-authenticate");
  }
}
