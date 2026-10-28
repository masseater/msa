import mcp from "@msa/mcp";
import testingModule from "@msa/mcp/testing";
import testing from "@msa/testing";
import { Effect } from "effect";

import InMemoryAuthStorageBackend from "../src/core/in-memory-auth-storage-backend.ts";
import runtime from "../src/extensions/mcp/runtime.ts";
import type mcpConnectionSupportTypes from "./mcp-connection-support.types.ts";

const { McpOAuthCredentialStore, McpServerConnection } = runtime;
const { LATEST_PROTOCOL_VERSION, McpSessionExpiredError } = mcp;
const { createInMemoryTransportPair } = testingModule;

const { runTest } = testing;

const fakeServers: mcpConnectionSupportTypes.FakeServer[] = [];

const STDIO_ENTRY: mcpConnectionSupportTypes.ServerEntry = {
  config: { command: "unused" },
  name: "fake",
  source: "test",
};

const HTTP_ENTRY: mcpConnectionSupportTypes.ServerEntry = {
  config: { headers: { Authorization: "x" }, url: "http://unused.invalid" },
  name: "fake",
  source: "test",
};

const initializeResult = (options: mcpConnectionSupportTypes.TransportOptions) => ({
  capabilities: {
    ...(options.noTools === true ? { prompts: {} } : { tools: {} }),
    ...(options.resources === true ? { resources: {} } : {}),
  },
  protocolVersion: LATEST_PROTOCOL_VERSION,
  serverInfo: { name: "fake", version: "1.0.0" },
});

const respond = (
  options: mcpConnectionSupportTypes.TransportOptions,
  id: string | number,
  method: string,
): mcpConnectionSupportTypes.JsonRpcMessage => {
  switch (method) {
    case "initialize":
      return { id, jsonrpc: "2.0", result: initializeResult(options) };
    case "tools/list":
      return options.noTools === true
        ? { error: { code: -32601, message: "Method not found" }, id, jsonrpc: "2.0" }
        : { id, jsonrpc: "2.0", result: { tools: [] } };
    case "resources/read":
      return { id, jsonrpc: "2.0", result: { contents: [{ text: "ok", uri: "docs://a" }] } };
    default:
      return { id, jsonrpc: "2.0", result: { content: [{ text: "ok", type: "text" }] } };
  }
};

const createTransport = (options: mcpConnectionSupportTypes.TransportOptions = {}) => {
  const pair = createInMemoryTransportPair();
  fakeServers.push(pair.server);
  pair.server.onMessage((message) => {
    if (!("id" in message) || !("method" in message)) return;
    options.methods?.push(message.method);
    const response = respond(options, message.id, message.method);
    const reply = () => void pair.server.send(response);
    queueMicrotask(reply);
  });
  void pair.server.start();
  if (options.expireFirstCall === true) {
    const send = pair.client.send.bind(pair.client);
    pair.client.send = (message: mcpConnectionSupportTypes.JsonRpcMessage) =>
      "method" in message && message.method === "tools/call"
        ? Promise.reject(McpSessionExpiredError.create("gone"))
        : send(message);
  }
  return pair.client;
};

const failingTransport = (error: Error) => () => {
  const transport = createTransport();
  transport.send = () => runTest(Effect.die(error));
  return transport;
};

const connect = (
  entry: mcpConnectionSupportTypes.ServerEntry,
  transports: (() => ReturnType<typeof createTransport>)[],
  log?: mcpConnectionSupportTypes.ServerLog,
) => {
  let opened = 0;
  const connection = new McpServerConnection({
    createTransport: () => {
      const transport = transports[opened++];
      if (transport === undefined) throw new Error(`no transport for connection ${opened}`);
      return transport();
    },
    credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
    cwd: process.cwd(),
    entry,
    ...(log === undefined ? {} : { log }),
    onTools: () => {},
  });
  return { connection, opened: () => opened };
};

const mcpConnectionSupport = {
  HTTP_ENTRY,
  STDIO_ENTRY,
  connect,
  createTransport,
  failingTransport,
  fakeServers,
};

export default mcpConnectionSupport;
