import { Effect } from "effect";

import type clientResultsTypes from "./client-results.types.ts";
import foreignModule from "./foreign.ts";
import type contentTypes from "./protocol/content.types.ts";
import McpClientError from "./protocol/errors/client-error.ts";
import jsonrpcModule from "./protocol/jsonrpc.ts";
import type jsonrpcTypes from "./protocol/jsonrpc.types.ts";
import type typesModule from "./protocol/types.types.ts";

const { JSON_RPC_ERROR_CODES, McpError, isObject } = jsonrpcModule;
const { fromSync } = foreignModule;

const MAX_LIST_PAGES = 1_000;

function validateInitializeResult(value: unknown): typesModule.InitializeResult {
  if (
    !isObject(value) ||
    typeof value["protocolVersion"] !== "string" ||
    !isObject(value["capabilities"]) ||
    !isObject(value["serverInfo"]) ||
    typeof value["serverInfo"]["name"] !== "string" ||
    typeof value["serverInfo"]["version"] !== "string" ||
    (value["instructions"] !== undefined && typeof value["instructions"] !== "string")
  ) {
    throw new McpError(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid MCP initialize result");
  }
  return value as unknown as typesModule.InitializeResult;
}

function invalid(message: string): jsonrpcTypes.McpError {
  return new McpError(JSON_RPC_ERROR_CODES.invalidRequest, message);
}

function validateListPage(
  method: string,
  key: string,
  value: unknown,
  isItem: clientResultsTypes.ItemCheck,
): clientResultsTypes.ListPage {
  const items = isObject(value) ? value[key] : undefined;
  if (!isObject(value) || !Array.isArray(items)) throw invalid(`Invalid MCP ${method} result`);
  for (const item of items) {
    if (!isObject(item) || !isItem(item)) throw invalid(`Invalid entry in MCP ${method} result`);
  }
  const nextCursor =
    value["nextCursor"] === null || value["nextCursor"] === "" ? undefined : value["nextCursor"];
  if (nextCursor !== undefined && typeof nextCursor !== "string")
    throw invalid(`Invalid MCP ${method} cursor`);
  return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
}

const isTool = (tool: Record<string, unknown>) =>
  typeof tool["name"] === "string" && isObject(tool["inputSchema"]);
const isResource = (resource: Record<string, unknown>) =>
  typeof resource["uri"] === "string" &&
  (resource["name"] === undefined || typeof resource["name"] === "string");
const isResourceTemplate = (template: Record<string, unknown>) =>
  typeof template["uriTemplate"] === "string" &&
  (template["name"] === undefined || typeof template["name"] === "string");

function toResource(item: Record<string, unknown>): typesModule.Resource {
  return { ...item, name: item["name"] ?? item["uri"] } as typesModule.Resource;
}

function toResourceTemplate(item: Record<string, unknown>): typesModule.ResourceTemplate {
  return { ...item, name: item["name"] ?? item["uriTemplate"] } as typesModule.ResourceTemplate;
}

function pageCursor(page: { nextCursor?: string }): { nextCursor?: string } {
  return page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor };
}

function validateReadResourceResult(value: unknown): typesModule.ReadResourceResult {
  if (!isObject(value) || !Array.isArray(value["contents"]))
    throw invalid("Invalid MCP resources/read result");
  for (const contents of value["contents"]) {
    if (
      !isObject(contents) ||
      typeof contents["uri"] !== "string" ||
      (typeof contents["text"] !== "string" && typeof contents["blob"] !== "string")
    ) {
      throw invalid("Invalid contents in MCP resources/read result");
    }
  }
  return value as unknown as typesModule.ReadResourceResult;
}

function validateCallToolResult(value: unknown): contentTypes.CallToolResult {
  if (!isObject(value) || (value["content"] !== undefined && !Array.isArray(value["content"]))) {
    throw new McpError(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid MCP tools/call result");
  }
  return (value["content"] === undefined
    ? { ...value, content: [] }
    : value) as unknown as contentTypes.CallToolResult;
}

const listPage = (
  spec: clientResultsTypes.ListSpec & { cursor: string | undefined },
): Effect.Effect<clientResultsTypes.ListPage, clientResultsTypes.McpRequestFailure> =>
  spec
    .request(spec.cursor)
    .pipe(
      Effect.flatMap((value) =>
        fromSync(() => validateListPage(spec.method, spec.key, value, spec.isItem)),
      ),
    );

const listAll = Effect.fn("listAll")(function* (spec: clientResultsTypes.ListSpec) {
  const items: Record<string, unknown>[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_LIST_PAGES; pageNumber++) {
    const page = yield* listPage({ ...spec, cursor });
    items.push(...page.items);
    if (page.nextCursor === undefined) return items;
    if (cursors.has(page.nextCursor))
      return yield* new McpClientError(
        `MCP ${spec.method} returned duplicate cursor: ${page.nextCursor}`,
      );
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  return yield* new McpClientError(`MCP ${spec.method} exceeded ${MAX_LIST_PAGES} pages`);
});

const clientResults = {
  isResource,
  isResourceTemplate,
  isTool,
  listAll,
  listPage,
  pageCursor,
  toResource,
  toResourceTemplate,
  validateCallToolResult,
  validateInitializeResult,
  validateReadResourceResult,
};

export default clientResults;
