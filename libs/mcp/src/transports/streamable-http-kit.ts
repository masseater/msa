import foreign from "../foreign.ts";
import jsonrpc from "../protocol/jsonrpc.ts";
import McpAuthRequiredError from "./errors/auth-required-error.ts";
import McpHttpError from "./errors/http-error.ts";
import McpSessionExpiredError from "./errors/session-expired-error.ts";
import McpTransportError from "./errors/transport-error.ts";

const streamableHttpKit = {
  McpAuthRequiredError,
  McpHttpError,
  McpSessionExpiredError,
  McpTransportError,
  foreign,
  jsonrpc,
};

export default streamableHttpKit;
