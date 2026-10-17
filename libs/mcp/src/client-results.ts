import { Effect } from "effect";

import { fromSync, type McpForeignError } from "./foreign.ts";
import type { CallToolResult } from "./protocol/content.ts";
import { McpClientError } from "./protocol/errors/client-error.ts";
import {
  isObject,
  JSON_RPC_ERROR_CODES,
  type McpAbortError,
  type McpConnectionClosedError,
  McpError,
} from "./protocol/jsonrpc.ts";
import type {
  InitializeResult,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
} from "./protocol/types.ts";

const MAX_LIST_PAGES = 1_000;

export type ItemCheck = (item: Record<string, unknown>) => boolean;

export interface ListPage {
  items: Record<string, unknown>[];
  nextCursor?: string;
}

export function validateInitializeResult(value: unknown): InitializeResult {
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
  return value as unknown as InitializeResult;
}

function invalid(message: string): McpError {
  return new McpError(JSON_RPC_ERROR_CODES.invalidRequest, message);
}

function validateListPage(
  method: string,
  key: string,
  value: unknown,
  isItem: ItemCheck,
): ListPage {
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

export const isTool = (tool: Record<string, unknown>) =>
  typeof tool["name"] === "string" && isObject(tool["inputSchema"]);
export const isResource = (resource: Record<string, unknown>) =>
  typeof resource["uri"] === "string" &&
  (resource["name"] === undefined || typeof resource["name"] === "string");
export const isResourceTemplate = (template: Record<string, unknown>) =>
  typeof template["uriTemplate"] === "string" &&
  (template["name"] === undefined || typeof template["name"] === "string");

export function toResource(item: Record<string, unknown>): Resource {
  return { ...item, name: item["name"] ?? item["uri"] } as Resource;
}

export function toResourceTemplate(item: Record<string, unknown>): ResourceTemplate {
  return { ...item, name: item["name"] ?? item["uriTemplate"] } as ResourceTemplate;
}

export function pageCursor(page: { nextCursor?: string }): { nextCursor?: string } {
  return page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor };
}

export function validateReadResourceResult(value: unknown): ReadResourceResult {
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
  return value as unknown as ReadResourceResult;
}

export function validateCallToolResult(value: unknown): CallToolResult {
  if (!isObject(value) || (value["content"] !== undefined && !Array.isArray(value["content"]))) {
    throw new McpError(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid MCP tools/call result");
  }
  return (value["content"] === undefined
    ? { ...value, content: [] }
    : value) as unknown as CallToolResult;
}

export type McpRequestFailure = McpForeignError | McpConnectionClosedError | McpAbortError;

export type PageRequest = (cursor: string | undefined) => Effect.Effect<unknown, McpRequestFailure>;

export interface ListSpec {
  method: string;
  key: string;
  isItem: ItemCheck;
  request: PageRequest;
}

export const listPage = (
  spec: ListSpec & { cursor: string | undefined },
): Effect.Effect<ListPage, McpRequestFailure> =>
  spec
    .request(spec.cursor)
    .pipe(
      Effect.flatMap((value) =>
        fromSync(() => validateListPage(spec.method, spec.key, value, spec.isItem)),
      ),
    );

export const listAll = Effect.fn("listAll")(function* (spec: ListSpec) {
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
