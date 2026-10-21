import { Data } from "effect";

export default class McpOAuthAuthorizationRequiredError extends Data.TaggedError(
  "McpOAuthAuthorizationRequiredError",
)<{ readonly message: string }> {
  constructor() {
    super({ message: "MCP OAuth authorization requires user interaction" });
  }
}
