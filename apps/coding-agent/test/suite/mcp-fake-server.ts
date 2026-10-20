import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";
import testing from "@msa/mcp/testing";
import { Effect } from "effect";

import type mcpFakeServerTypes from "./mcp-fake-server.types.ts";

const { LATEST_PROTOCOL_VERSION } = mcp;
const { createInMemoryTransportPair } = testing;

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const SERVER_TOOLS = [
  {
    description: "Search the docs.",
    inputSchema: { properties: { query: { type: "string" } }, required: ["query"], type: "object" },
    name: "search",
    outputSchema: {
      properties: { hits: { items: { type: "string" }, type: "array" } },
      required: ["hits"],
      type: "object",
    },
  },
  {
    annotations: {
      destructiveHint: true,
      idempotentHint: "yes",
      readOnlyHint: false,
      title: "Fail",
    },
    description: "Always fails.",
    inputSchema: { properties: {}, type: "object" },
    name: "fail",
  },
  {
    description: "Returns an image.",
    inputSchema: { properties: {}, type: "object" },
    name: "shot",
  },
];

const RESOURCES = [
  { _meta: { x: 1 }, mimeType: "text/markdown", name: "intro", uri: "docs://intro" },
  { mimeType: "text/html;profile=mcp-app", name: "viewer", uri: "ui://docs/viewer" },
];

const RESOURCE_TEMPLATES = [
  {
    icons: [{ src: "data:image/png;base64,AAAA" }],
    name: "page",
    uriTemplate: "docs://pages/{slug}",
  },
];

const callTool = (calls: string[], request: mcpTypes.JsonRpcRequest): unknown => {
  const params = request.params as { name: string; arguments?: { query?: string } };
  calls.push(`${params.name}:${JSON.stringify(params.arguments ?? {})}`);
  if (params.name === "search") {
    const hits = [`${params.arguments?.query} guide`, `${params.arguments?.query} faq`];
    return { content: [{ text: hits.join("\n"), type: "text" }], structuredContent: { hits } };
  }
  if (params.name === "shot") {
    return { content: [{ data: TINY_PNG_BASE64, mimeType: "image/png", type: "image" }] };
  }
  return { content: [{ text: "server exploded", type: "text" }], isError: true };
};

const readResource = (calls: string[], request: mcpTypes.JsonRpcRequest): unknown => {
  const { uri } = request.params as { uri: string };
  calls.push(`read:${uri}`);
  return { contents: [{ mimeType: "text/markdown", text: `# ${uri}`, uri }] };
};

const initializeResult = (options: mcpFakeServerTypes.Options): unknown => ({
  capabilities: { tools: {}, ...(options.resources === true ? { resources: {} } : {}) },
  protocolVersion: LATEST_PROTOCOL_VERSION,
  serverInfo: { name: "docs", version: "1.0.0" },
  ...(options.instructions !== undefined && options.instructions !== ""
    ? { instructions: options.instructions }
    : {}),
});

const respond = (
  calls: string[],
  options: mcpFakeServerTypes.Options,
  request: mcpTypes.JsonRpcRequest,
): unknown => {
  switch (request.method) {
    case "initialize":
      return initializeResult(options);
    case "tools/list":
      return { tools: (options.listTools ?? (() => SERVER_TOOLS))() };
    case "resources/list":
      return { resources: RESOURCES };
    case "resources/templates/list":
      return { resourceTemplates: RESOURCE_TEMPLATES };
    case "resources/read":
      return readResource(calls, request);
    case "tools/call":
      return callTool(calls, request);
    default:
      return {};
  }
};

const createFakeServer = (calls: string[], options: mcpFakeServerTypes.Options = {}) => {
  const pair = createInMemoryTransportPair();
  const initializeDelayMs = options.initializeDelayMs ?? 0;
  pair.server.onMessage((message) => {
    if (!("id" in message) || !("method" in message)) return;
    const request = message as mcpTypes.JsonRpcRequest;
    const send = () =>
      void pair.server.send({
        id: request.id,
        jsonrpc: "2.0",
        result: respond(calls, options, request),
      });
    if (request.method !== "initialize" || initializeDelayMs === 0) queueMicrotask(send);
    else if (Number.isFinite(initializeDelayMs))
      Effect.runFork(
        Effect.sleep(`${initializeDelayMs} millis`).pipe(Effect.andThen(Effect.sync(send))),
      );
  });
  return pair;
};

const mcpFakeServer = {
  SERVER_TOOLS,
  TINY_PNG_BASE64,
  createFakeServer,
};

export default mcpFakeServer;
