import foreign from "../foreign.ts";
import jsonrpc from "../protocol/jsonrpc.ts";
import McpAuthRequiredError from "./errors/auth-required-error.ts";
import McpHttpError from "./errors/http-error.ts";
import McpSessionExpiredError from "./errors/session-expired-error.ts";
import httpSupport from "./http-support.ts";

const streamableHttpConnectionKit = {
  McpAuthRequiredError,
  McpHttpError,
  McpSessionExpiredError,
  foreign,
  httpSupport,
  jsonrpc,
};

export default streamableHttpConnectionKit;
