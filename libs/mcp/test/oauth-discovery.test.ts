import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  OAuthInsecureEndpointError,
  OAuthIssuerMismatchError,
  authorizeMcp,
  discoverAuthorizationServerMetadata,
  registerClient,
} from "../src/oauth/index.ts";
import helpers from "./helpers.ts";
import oauthSupport from "./oauth-support.ts";

const { closeServers, listen, readBody, readMessage } = helpers;
const { TestOAuthProvider, authorizationServerMetadata, endWith, sendJson } = oauthSupport;

const derivesApplicationType = Effect.gen(function* () {
  const bodies: Record<string, unknown>[] = [];
  const origin = yield* listen((request) =>
    readMessage(request).pipe(
      Effect.flatMap((metadata) => {
        bodies.push(metadata);
        return sendJson(201, { ...metadata, client_id: "client" });
      }),
    ),
  );
  const register = (redirect_uris: string[], application_type?: string) =>
    registerClient(origin, {
      clientMetadata: {
        redirect_uris,
        ...(application_type === undefined ? {} : { application_type }),
      },
    });
  yield* register(["http://127.0.0.1:1234/callback"]);
  yield* register(["http://[::1]/callback"]);
  yield* register(["com.example.app:/callback"]);
  yield* register(["https://app.example/callback"]);
  yield* register(["http://localhost/callback"], "web");
  expect(bodies.map((body) => body["application_type"])).toEqual([
    "native",
    "native",
    "native",
    "web",
    "web",
  ]);
});

const rejectsIssuerMismatch = Effect.gen(function* () {
  const origin = yield* listen((request, serverOrigin) => {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return sendJson(200, {
        ...authorizationServerMetadata(serverOrigin),
        issuer: "https://attacker.example",
      });
    return endWith(404);
  });
  const error = yield* Effect.flip(discoverAuthorizationServerMetadata(origin));
  expect(error).toBeInstanceOf(OAuthIssuerMismatchError);
});

const usesConfiguredMetadata = Effect.gen(function* () {
  const origin = yield* listen((request, serverOrigin) => {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
      return sendJson(200, {
        authorization_servers: [serverOrigin],
        resource: `${serverOrigin}/mcp`,
      });
    if (url.pathname === "/idp/metadata.json")
      return sendJson(200, {
        authorization_endpoint: `${serverOrigin}/idp/authorize`,
        issuer: "https://idp.example",
        response_types_supported: ["code"],
        token_endpoint: `${serverOrigin}/idp/token`,
      });
    return endWith(404);
  });
  const provider = new TestOAuthProvider("http://127.0.0.1/callback");
  provider.client = { client_id: "client" };
  const options = {
    authorizationServerMetadataUrl: new URL(`${origin}/idp/metadata.json`),
    serverUrl: `${origin}/mcp`,
  };
  expect(yield* authorizeMcp(provider, options)).toBe("REDIRECT");
  const authorizationUrl = provider.authorizationUrl as URL;
  expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(`${origin}/idp/authorize`);
  expect(authorizationUrl.searchParams.get("resource")).toBe(`${origin}/mcp`);
  const insecure = {
    ...options,
    authorizationServerMetadataUrl: new URL("http://idp.example/metadata.json"),
  };
  const error = yield* Effect.flip(authorizeMcp(provider, insecure));
  expect(error).toBeInstanceOf(OAuthInsecureEndpointError);
});

interface ExchangeCase {
  code: string;
  iss: string | undefined;
  issParameterSupported: boolean;
  metadata?: boolean;
}

const exchangeWith =
  (origin: string) =>
  ({ code, iss, issParameterSupported, metadata = true }: ExchangeCase) => {
    const provider = new TestOAuthProvider("http://127.0.0.1/callback");
    provider.client = { client_id: "client" };
    provider.verifier = "verifier";
    provider.discovery = {
      authorizationServerMetadata: metadata
        ? {
            ...authorizationServerMetadata(origin),
            authorization_response_iss_parameter_supported: issParameterSupported,
          }
        : undefined,
      authorizationServerUrl: origin,
    };
    return authorizeMcp(provider, { authorizationCode: code, iss, serverUrl: `${origin}/mcp` });
  };

const verifiesIss = Effect.gen(function* () {
  const codes: string[] = [];
  const origin = yield* listen((request) => {
    if (request.method !== "POST") return endWith(404);
    return readBody(request).pipe(
      Effect.flatMap((body) => {
        codes.push(new URLSearchParams(body).get("code") ?? "");
        return sendJson(200, { access_token: "token", token_type: "Bearer" });
      }),
    );
  });
  const exchange = exchangeWith(origin);
  const attacker = "https://attacker.example";
  const mismatch = (testCase: ExchangeCase) =>
    Effect.flip(exchange(testCase)).pipe(
      Effect.map((error) => expect(error).toBeInstanceOf(OAuthIssuerMismatchError)),
    );
  yield* mismatch({ code: "other", iss: attacker, issParameterSupported: false });
  yield* mismatch({ code: "missing", iss: undefined, issParameterSupported: true });
  expect(yield* exchange({ code: "matching", iss: origin, issParameterSupported: true })).toBe(
    "AUTHORIZED",
  );
  expect(yield* exchange({ code: "omitted", iss: undefined, issParameterSupported: false })).toBe(
    "AUTHORIZED",
  );
  yield* mismatch({
    code: "unverifiable",
    iss: attacker,
    issParameterSupported: false,
    metadata: false,
  });
  expect(
    yield* exchange({
      code: "no-metadata",
      iss: undefined,
      issParameterSupported: false,
      metadata: false,
    }),
  ).toBe("AUTHORIZED");
  expect(codes).toEqual(["matching", "omitted", "no-metadata"]);
});

afterEach(() => Effect.runPromise(closeServers));

describe("MCP OAuth discovery", () => {
  it("registers with an application_type derived from the redirect URIs unless one is set", () =>
    Effect.runPromise(derivesApplicationType));
  it("rejects authorization metadata whose issuer does not match discovery", () =>
    Effect.runPromise(rejectsIssuerMismatch));
  it("uses a configured authorization server metadata document as is", () =>
    Effect.runPromise(usesConfiguredMetadata));
  it("exchanges a code only when its iss parameter names the authorization server", () =>
    Effect.runPromise(verifiesIss));
});
