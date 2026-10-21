import net from "node:net";
import tls from "node:tls";

import testing from "@msa/testing";
import { Effect } from "effect";
import * as undici from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import httpDispatcher from "../src/core/http-dispatcher.ts";
import platform from "../src/core/platform/index.ts";

const { applyHttpProxySettings, configureHttpDispatcher } = httpDispatcher;
const { readEnv } = platform;

const { awaited, deferredPromise, runTest } = testing;

const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY"] as const;
const DISPATCHER_PROXY_ENV_KEYS = [
  ...PROXY_ENV_KEYS,
  "http_proxy",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

const clearEnv = (keys: readonly string[]): void => {
  for (const key of keys) vi.stubEnv(key, undefined);
};

const ORIGIN_RESPONSE = "HTTP/1.1 200 OK\r\ncontent-length: 6\r\nconnection: close\r\n\r\norigin";

const listenOnFreePort = (server: net.Server): Effect.Effect<number> =>
  Effect.gen(function* () {
    const listening = deferredPromise<void>();
    server.listen(0, "127.0.0.1", () => listening.resolve(undefined));
    yield* Effect.promise(() => listening.promise);
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Server did not bind to a TCP port");
    }
    return address.port;
  });

const closeServer = (server: net.Server): Effect.Effect<void> =>
  Effect.gen(function* () {
    const closed = deferredPromise<void>();
    server.close(() => closed.resolve(undefined));
    yield* Effect.promise(() => closed.promise);
  });

const appliesHttpproxyToHttpProxyAndHttps = () => {
  applyHttpProxySettings("http://127.0.0.1:7890");

  expect(readEnv("HTTP_PROXY")).toBe("http://127.0.0.1:7890");
  expect(readEnv("HTTPS_PROXY")).toBe("http://127.0.0.1:7890");
};

const doesNotOverrideExistingProxyEnvVars = () => {
  vi.stubEnv("HTTP_PROXY", "http://env-http:8080");
  vi.stubEnv("HTTPS_PROXY", "http://env-https:8080");

  applyHttpProxySettings("http://settings:7890");

  expect(readEnv("HTTP_PROXY")).toBe("http://env-http:8080");
  expect(readEnv("HTTPS_PROXY")).toBe("http://env-https:8080");
};

const ignoresEmptyValues = () => {
  applyHttpProxySettings("   ");

  expect(readEnv("HTTP_PROXY")).toBeUndefined();
  expect(readEnv("HTTPS_PROXY")).toBeUndefined();
};

describe("http proxy settings", () => {
  beforeEach(() => clearEnv(PROXY_ENV_KEYS));

  it("applies httpProxy to HTTP_PROXY and HTTPS_PROXY", appliesHttpproxyToHttpProxyAndHttps);

  it("does not override existing proxy env vars", doesNotOverrideExistingProxyEnvVars);

  it("ignores empty values", ignoresEmptyValues);
});

const originalDispatcher = undici.getGlobalDispatcher();

const originalFetch = globalThis.fetch;

const tunnelsProxiedHttpOriginsSetup = () =>
  Effect.gen(function* () {
    const origin = net.createServer((socket) => {
      socket.once("data", () => socket.end(ORIGIN_RESPONSE));
    });
    const originPort = yield* listenOnFreePort(origin);

    const proxyRequestLines: string[] = [];
    const proxy = net.createServer((client) => {
      client.once("data", (data) => {
        const [requestLine = ""] = data.toString().split("\r\n");
        proxyRequestLines.push(requestLine);
        if (!requestLine.startsWith("CONNECT ")) {
          client.end(
            "HTTP/1.1 501 Not Implemented\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
          );
          return;
        }

        const upstream = net.connect(originPort, "127.0.0.1", () => {
          client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
      });
    });
    return { origin, originPort, proxy, proxyRequestLines };
  });

const tunnelsProxiedHttpOrigins = () =>
  runTest(
    Effect.gen(function* () {
      const { origin, originPort, proxy, proxyRequestLines } =
        yield* tunnelsProxiedHttpOriginsSetup();
      const proxyPort = yield* listenOnFreePort(proxy);

      vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
      configureHttpDispatcher();
      const dispatcher = undici.getGlobalDispatcher();
      try {
        const originUrl = `http://127.0.0.1:${originPort}/v1/chat/completions`;
        yield* awaited(
          expect(undici.fetch(originUrl).then((response) => response.text())).resolves.toBe(
            "origin",
          ),
        );
        yield* awaited(
          expect(undici.fetch(originUrl).then((response) => response.text())).resolves.toBe(
            "origin",
          ),
        );
        expect(proxyRequestLines).not.toHaveLength(0);
        expect(proxyRequestLines).toEqual(
          expect.arrayContaining([
            expect.stringMatching(`^CONNECT 127\\.0\\.0\\.1:${originPort} HTTP/1\\.1$`),
          ]),
        );
      } finally {
        yield* awaited(dispatcher.close());
        undici.setGlobalDispatcher(originalDispatcher);
        yield* closeServer(proxy);
        yield* closeServer(origin);
      }
    }),
  );

const allowsTwoSecondsForHttpsConnectionAttempts = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      globalThis.fetch = () =>
        effectRunPromise(
          Effect.sync(() => {
            throw new Error("Unexpected global fetch");
          }),
        );
      const originalAttemptTimeoutMs = net.getDefaultAutoSelectFamilyAttemptTimeout();
      const connectSpy = vi.spyOn(tls, "connect").mockImplementation(() => {
        throw new Error("Connection captured");
      });

      configureHttpDispatcher();
      yield* awaited(expect(undici.fetch("https://example.invalid")).rejects.toThrow());

      expect(connectSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          autoSelectFamilyAttemptTimeout: 2_000,
        }),
      );
      expect(connectSpy.mock.calls[0]?.[0]).not.toHaveProperty("autoSelectFamily");
      expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(originalAttemptTimeoutMs);
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      const dispatcher = undici.getGlobalDispatcher();
      if (dispatcher !== originalDispatcher) {
        yield* awaited(dispatcher.close());
        undici.setGlobalDispatcher(originalDispatcher);
      }
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    }),
  );

describe("http dispatcher", () => {
  beforeEach(() => clearEnv(DISPATCHER_PROXY_ENV_KEYS));

  afterEach(afterEachHook);

  it("tunnels proxied HTTP origins", tunnelsProxiedHttpOrigins);

  it(
    "allows two seconds for HTTPS connection attempts without changing the Node default",
    allowsTwoSecondsForHttpsConnectionAttempts,
  );
});
