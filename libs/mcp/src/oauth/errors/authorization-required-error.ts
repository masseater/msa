import { Schema } from "effect";

export default class McpOAuthAuthorizationRequiredError extends Schema.TaggedError<
  McpOAuthAuthorizationRequiredError,
  { readonly brand: unique symbol }
>()("McpOAuthAuthorizationRequiredError", { message: Schema.String }) {
  static create(): McpOAuthAuthorizationRequiredError {
    return McpOAuthAuthorizationRequiredError.make({
      message: "MCP OAuth authorization requires user interaction",
    });
  }
}
