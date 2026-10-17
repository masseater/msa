import { Data } from "effect";

export class McpOAuthAuthorizationRequiredError extends Data.TaggedError(
  "McpOAuthAuthorizationRequiredError",
)<{ readonly message: string }> {
  constructor() {
    super({ message: "MCP OAuth authorization requires user interaction" });
  }
}
