import { Deferred, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  type AuthProvider,
  McpClient,
  type McpFetch,
  StreamableHttpTransport,
} from "../src/index.ts";
import {
  closeServers,
  type HttpRequest,
  type HttpResponse,
  readBody,
  readMessage,
} from "./helpers.ts";
import {
  protocolHandler,
  protocolHandlerFor,
  type RecordedRequest,
  startServer,
} from "./http-fixture.ts";

const newClient = () => new McpClient({ name: "http-test", version: "1.0.0" });

const abortController = (): AbortController => new AbortController();

const unauthorized = (response: HttpResponse, authenticate: string) =>
  Effect.sync(() => {
    response.writeHead(401, { "www-authenticate": authenticate }).end();
  });

const connectWith = (client: McpClient, url: string, authProvider: AuthProvider) =>
  Effect.promise(() =>
    client.connect(new StreamableHttpTransport({ url, openGetStream: false, authProvider })),
  );

const scopeHandler = (request: HttpRequest, response: HttpResponse, requests: RecordedRequest[]) =>
  Effect.gen(function* () {
    if (request.method !== "POST") return yield* protocolHandler(request, response, requests);
    const message = yield* readMessage(request);
    if (request.headers.authorization === "Bearer old")
      return yield* unauthorized(response, "Bearer");
    if (message["method"] === "tools/call" && request.headers.authorization === "Bearer new") {
      response
        .writeHead(403, { "www-authenticate": 'Bearer error="insufficient_scope", scope="admin"' })
        .end();
      return;
    }
    yield* protocolHandlerFor(message)(request, response, requests);
  });

const handsFailuresToProvider = Effect.gen(function* () {
  const seen: { status: number; token?: string | undefined }[] = [];
  let token = "old";
  const { url } = yield* startServer(scopeHandler);
  const client = newClient();
  yield* connectWith(client, url, {
    token: () => Promise.resolve(token),
    onUnauthorized: ({ response, token: rejected }) => {
      seen.push({ status: response.status, token: rejected });
      token = response.status === 401 ? "new" : "admin";
      return Promise.resolve();
    },
  });
  expect(yield* Effect.promise(() => client.callTool("echo"))).toEqual({
    content: [{ type: "text", text: "hello" }],
  });
  expect(seen).toEqual([
    { status: 401, token: "old" },
    { status: 403, token: "new" },
  ]);
  yield* Effect.promise(() => client.close());
});

const recordingHandler =
  (executed: unknown[]) =>
  (request: HttpRequest, response: HttpResponse, requests: RecordedRequest[]) =>
    Effect.gen(function* () {
      if (request.method !== "POST") return yield* protocolHandler(request, response, requests);
      const message = yield* readMessage(request);
      const isCall = message["method"] === "tools/call";
      if (isCall && request.headers.authorization === "Bearer old")
        return yield* unauthorized(response, "Bearer");
      if (isCall) executed.push((message["params"] as { name: string }).name);
      yield* protocolHandlerFor(message)(request, response, requests);
    });

const recoveringProvider = () => {
  const state = { token: "old", refreshes: 0, waiting: 0 };
  const refreshGate = Deferred.makeUnsafe<void>();
  const allWaiting = Deferred.makeUnsafe<void>();
  let refresh: Promise<void> | undefined;
  const provider: AuthProvider = {
    token: () => Promise.resolve(state.token),
    onUnauthorized: () => {
      if (refresh === undefined) {
        state.refreshes++;
        refresh = Effect.runPromise(
          Deferred.await(refreshGate).pipe(
            Effect.andThen(
              Effect.sync(() => {
                state.token = "new";
              }),
            ),
          ),
        );
      }
      if (++state.waiting === 3) Deferred.doneUnsafe(allWaiting, Effect.void);
      return refresh;
    },
  };
  return { state, refreshGate, allWaiting, provider };
};

const skipsCancelledRetries = Effect.gen(function* () {
  const executed: unknown[] = [];
  const { state, refreshGate, allWaiting, provider } = recoveringProvider();
  const { url } = yield* startServer(recordingHandler(executed));
  const client = newClient();
  yield* connectWith(client, url, provider);
  const controller = abortController();
  const aborted = client.callTool("aborted", {}, { signal: controller.signal });
  const timedOut = client.callTool("timed-out", {}, { timeoutMs: 200 });
  const kept = client.callTool("kept");
  yield* Deferred.await(allWaiting);
  controller.abort();
  yield* Effect.promise(() => expect(aborted).rejects.toMatchObject({ name: "AbortError" }));
  yield* Effect.promise(() => expect(timedOut).rejects.toMatchObject({ name: "McpTimeoutError" }));
  Deferred.doneUnsafe(refreshGate, Effect.void);
  expect(yield* Effect.promise(() => kept)).toEqual({ content: [{ type: "text", text: "hello" }] });
  expect(executed).toEqual(["kept"]);
  expect(state.refreshes).toBe(1);
  yield* Effect.promise(() => client.close());
});

const closesWithLastToken = Effect.gen(function* () {
  const { url, requests } = yield* startServer(protocolHandler);
  let calls = 0;
  const client = newClient();
  yield* connectWith(client, url, { token: () => Promise.resolve(`token-${++calls}`) });
  const before = calls;
  yield* Effect.promise(() => client.close());
  expect(calls).toBe(before);
  const deletes = requests.filter((entry) => entry.method === "DELETE");
  expect(deletes.map((entry) => entry.headers.authorization)).toEqual([`Bearer token-${before}`]);
  expect(deletes[0]?.headers["mcp-session-id"]).toBe("session-1");
});

const realFetch = globalThis.fetch;

const strictFetch = function (this: unknown, input: string | URL, init?: RequestInit) {
  if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
  return realFetch(input, init);
} satisfies McpFetch;

const connectThrough = (url: string, fetch: McpFetch | undefined) =>
  Effect.gen(function* () {
    let token: string | undefined;
    const client = newClient();
    yield* Effect.promise(() =>
      client.connect(
        new StreamableHttpTransport({
          url,
          ...(fetch === undefined ? {} : { fetch }),
          openGetStream: false,
          authProvider: {
            token: () => Promise.resolve(token),
            onUnauthorized: (context) =>
              context
                .fetch(url)
                .then((response) => response.body?.cancel())
                .then(() => {
                  token = "token";
                  return undefined;
                }),
          },
        }),
      ),
    );
    expect(yield* Effect.promise(() => client.listTools())).toEqual([
      { name: "echo", inputSchema: { type: "object" } },
    ]);
    yield* Effect.promise(() => client.close());
  });

const callsFetchWithoutReceiver = Effect.gen(function* () {
  const { url } = yield* startServer((request, response, requests) => {
    if (request.method !== "POST" || request.headers.authorization !== undefined)
      return protocolHandler(request, response, requests);
    return readBody(request).pipe(Effect.andThen(unauthorized(response, "Bearer")));
  });
  yield* connectThrough(url, strictFetch);
  vi.stubGlobal("fetch", strictFetch);
  yield* connectThrough(url, undefined).pipe(Effect.ensuring(Effect.sync(vi.unstubAllGlobals)));
});

afterEach(() => Effect.runPromise(closeServers));

describe("StreamableHttpTransport authorization", () => {
  it("hands 401 and insufficient-scope 403 responses to the auth provider with the rejected token", () =>
    Effect.runPromise(handsFailuresToProvider));
  it("does not retry requests that were cancelled while authorization was recovering", () =>
    Effect.runPromise(skipsCancelledRetries));
  it("closes the session with the last request's token, without asking the auth provider", () =>
    Effect.runPromise(closesWithLastToken));
  it("calls fetch without a receiver", () => Effect.runPromise(callsFetchWithoutReceiver));
});
