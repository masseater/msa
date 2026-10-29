import { Deferred, Effect, Schema, type Scope } from "effect";
import { Base64Url } from "effect/encoding";

import cryptoModule from "../../utils/crypto.ts";
import localHttpServer from "../../utils/local-http-server.ts";
import type localHttpServerTypes from "../../utils/local-http-server.types.ts";
import oauthPage from "../../utils/oauth-page.ts";
import providerEnv from "../../utils/provider-env.ts";
import type typesModule from "../types.ts";
import openaiChatgptToken from "./openai-chatgpt-token.ts";
import pkce from "./pkce.ts";

const { DIRECT_TOKEN_SCOPE, RESOURCE, exchangeAuthorizationCode, refreshAccessToken } =
  openaiChatgptToken;
const { getProviderEnvValue } = providerEnv;
const { randomBytes } = cryptoModule;
const { oauthErrorReply, oauthSuccessReply } = oauthPage;
const { startLocalHttpServer } = localHttpServer;
const { generatePKCE } = pkce;

const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
const AGENT_NAME_HINT = "msa";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_TOKEN_SCOPE}`;

const callbackHost = (): string => {
  const configured = getProviderEnvValue("MSA_OAUTH_CALLBACK_HOST");
  return configured === undefined || configured === "" ? "127.0.0.1" : configured;
};

interface AuthorizationResult {
  readonly code: string;
  readonly clientId: string;
}

class CallbackError extends Schema.TaggedError<CallbackError, { readonly brand: unique symbol }>()(
  "CallbackError",
  { message: Schema.String },
) {}

const randomValue = (): string => Base64Url.encode(randomBytes(32));

const authorizationResultFromCallback = (
  url: URL,
  expectedState: string,
): Effect.Effect<AuthorizationResult, CallbackError> => {
  const fail = (message: string) => Effect.fail(CallbackError.make({ message }));
  const code = url.searchParams.get("code");
  if (code === null || code === "") return fail("Missing authorization code");
  const state = url.searchParams.get("state");
  if (state === null || state === "") return fail("Missing OAuth state");
  if (state !== expectedState) return fail("OAuth state mismatch");
  const clientId = url.searchParams.get("client_id")?.trim();
  if (clientId === undefined || clientId === "")
    return fail("OpenAI OAuth registration callback did not contain an issued client ID");
  return Effect.succeed({ clientId, code });
};

const authorizationResultFromManualInput = (
  input: string,
  expectedState: string,
): Effect.Effect<AuthorizationResult> =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      catch: () => CallbackError.make({ message: "Paste the full callback URL from the browser" }),
      try: () => new URL(input.trim()),
    });
    const expected = new URL(REDIRECT_URI);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
      return yield* CallbackError.make({
        message: `The pasted callback URL must start with ${REDIRECT_URI}`,
      });
    }
    const error = url.searchParams.get("error");
    if (error !== null && error !== "") {
      return yield* CallbackError.make({ message: `ChatGPT authorization failed: ${error}` });
    }
    return yield* authorizationResultFromCallback(url, expectedState);
  }).pipe(Effect.catchTag("CallbackError", (error) => Effect.die(new Error(error.message))));

interface CallbackListener {
  readonly server: localHttpServerTypes.LocalHttpServer;
  readonly result: Deferred.Deferred<AuthorizationResult>;
}

const handleCallback = (
  { url }: localHttpServerTypes.LocalHttpRequest,
  expectedState: string,
  result: Deferred.Deferred<AuthorizationResult>,
): Effect.Effect<localHttpServerTypes.LocalHttpResponse> => {
  if (url.pathname !== CALLBACK_PATH) {
    return Effect.succeed(oauthErrorReply(404, "Callback route not found.", undefined));
  }
  const error = url.searchParams.get("error");
  if (error !== null && error !== "") {
    return Effect.as(
      Deferred.die(result, new Error(`ChatGPT authorization failed: ${error}`)),
      oauthErrorReply(400, "ChatGPT was not connected.", `Error: ${error}`),
    );
  }
  return authorizationResultFromCallback(url, expectedState).pipe(
    Effect.flatMap((authorization) =>
      Effect.as(
        Deferred.succeed(result, authorization),
        oauthSuccessReply(200, "ChatGPT authentication completed. You can close this window."),
      ),
    ),
    Effect.catchTag("CallbackError", (failure) =>
      Effect.succeed(oauthErrorReply(400, failure.message, undefined)),
    ),
  );
};

const isAddressInUse = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "EADDRINUSE";

const listenForCallback = (expectedState: string): Effect.Effect<CallbackListener> =>
  Effect.gen(function* () {
    const result = yield* Deferred.make<AuthorizationResult>();
    const server = yield* startLocalHttpServer({
      baseUrl: REDIRECT_URI,
      closeConnections: true,
      handle: (request, reply) =>
        handleCallback(request, expectedState, result).pipe(
          Effect.catchDefect(() =>
            Effect.succeed(
              oauthErrorReply(500, "Internal error while processing the callback.", undefined),
            ),
          ),
          Effect.flatMap(reply),
        ),
      host: callbackHost(),
      onError: (error) => Effect.asVoid(Deferred.die(result, error)),
      port: CALLBACK_PORT,
    });
    return { result, server };
  }).pipe(
    Effect.catchDefect((error) =>
      Effect.die(
        isAddressInUse(error)
          ? new Error(
              `Port ${CALLBACK_PORT} is in use, probably by an unfinished login in another msa session or by the Codex CLI. Cancel that login and try again.`,
            )
          : error,
      ),
    ),
  );

const agentHostId = (deviceId: string | undefined): Effect.Effect<string> =>
  deviceId === undefined || deviceId === "" || !UUID_PATTERN.test(deviceId)
    ? Effect.die(
        new Error("Sign in with ChatGPT requires a device ID (UUID) for this installation"),
      )
    : Effect.succeed(`urn:uuid:${deviceId.toLowerCase()}`);

interface AuthorizationRequest {
  readonly hostId: string;
  readonly agentName: string;
  readonly state: string;
  readonly challenge: string;
}

const authorizationUrl = ({ hostId, agentName, state, challenge }: AuthorizationRequest): URL => {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    agent_name_hint: agentName,
    client_id: DYNAMIC_CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ext_agent_host_id: hostId,
    nonce: randomValue(),
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    response_type: "code",
    scope: SCOPE,
    state,
  }).toString();
  return url;
};

const awaitAuthorization = (
  interaction: typesModule.ProviderAuthInteraction,
  listener: CallbackListener,
  state: string,
): Effect.Effect<AuthorizationResult, never, Scope.Scope> =>
  Effect.gen(function* () {
    const signal = yield* Effect.abortSignal;
    const manual = Effect.flatMap(
      Effect.promise(() =>
        interaction.prompt({
          message: "Complete login in your browser, or paste the final redirect URL here:",
          placeholder: REDIRECT_URI,
          signal: AbortSignal.any([signal, interaction.signal]),
          type: "manual_code",
        }),
      ),
      (input) => authorizationResultFromManualInput(input, state),
    );
    return yield* Effect.raceFirst(Deferred.await(listener.result), manual);
  });

const loginOpenAIChatGPT = (
  interaction: typesModule.ProviderAuthInteraction,
  options?: typesModule.LoginOptions,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const hostId = yield* agentHostId(options?.getDeviceId?.());
    const { verifier, challenge } = yield* Effect.promise(() => generatePKCE());
    const state = randomValue();
    const agentName = options?.agentName ?? AGENT_NAME_HINT;
    const listener = yield* listenForCallback(state);
    interaction.notify({
      instructions:
        "Complete sign-in in your browser. If the callback does not complete, paste the final redirect URL here.",
      type: "auth_url",
      url: authorizationUrl({ agentName, challenge, hostId, state }).toString(),
    });
    return yield* Effect.gen(function* () {
      const result = yield* awaitAuthorization(interaction, listener, state);
      interaction.notify({
        message: "Exchanging authorization code for tokens...",
        type: "progress",
      });
      return yield* exchangeAuthorizationCode({
        clientId: result.clientId,
        code: result.code,
        redirectUri: REDIRECT_URI,
        signal: interaction.signal,
        verifier,
      });
    }).pipe(
      Effect.scoped,
      Effect.catchDefect((error) =>
        Effect.die(
          interaction.signal.aborted ? new Error("Login cancelled", { cause: error }) : error,
        ),
      ),
      Effect.ensuring(listener.server.close),
    );
  });

const openaiChatGPTOAuth: typesModule.OAuthAuth = {
  isSubscription: true,
  login: (interaction, options) => Effect.runPromise(loginOpenAIChatGPT(interaction, options)),
  loginLabel: "Sign in with ChatGPT",
  name: "OpenAI (ChatGPT subscription)",
  refresh: (credential, signal) => Effect.runPromise(refreshAccessToken(credential, signal)),
  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};

const openaiChatgpt = {
  openaiChatGPTOAuth,
};

export default openaiChatgpt;
