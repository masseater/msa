import { Effect } from "effect";

import type {
  ApiKeyAuth,
  Credential,
  CredentialStore,
  OAuthAuth,
  ProviderAuth,
} from "../src/auth/types.ts";
import { type Provider } from "../src/models.ts";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  StreamOptions,
} from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

interface ProviderCall {
  model: Model<Api>;
  options: StreamOptions | undefined;
}

function testModel(provider: string, id: string): Model<Api> {
  return {
    api: "test-api",
    baseUrl: "https://example.test/v1",
    contextWindow: 10000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 1000,
    name: id,
    provider,
    reasoning: false,
  };
}

function doneMessage(model: Model<Api>, text: string): AssistantMessage {
  return {
    api: model.api,
    content: [{ text, type: "text" }],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

const ambientAuth: ApiKeyAuth = {
  name: "Ambient",
  resolve: () => Promise.resolve({ auth: {} }),
};

function testProvider(input: {
  id: string;
  models?: Model<Api>[];
  auth?: ProviderAuth;
  getModels?: () => readonly Model<Api>[];
  refreshModels?: Provider["refreshModels"];
  calls?: ProviderCall[];
}): Provider {
  const models = input.models ?? [testModel(input.id, "model-a")];
  const respond = (model: Model<Api>, options: StreamOptions | undefined) => {
    input.calls?.push({ model, options });
    const stream = new AssistantMessageEventStream();
    const message = doneMessage(model, "ok");
    stream.push({ partial: message, type: "start" });
    stream.push({ message, reason: "stop", type: "done" });
    stream.end(message);
    return stream;
  };
  return {
    auth: input.auth ?? { apiKey: ambientAuth },
    getModels: input.getModels ?? (() => models),
    id: input.id,
    name: input.id,
    stream: (model, _context, options) => respond(model, options as StreamOptions | undefined),
    streamSimple: (model, _context, options) =>
      respond(model, options as SimpleStreamOptions | undefined),
    ...(input.refreshModels === undefined ? {} : { refreshModels: input.refreshModels }),
  };
}

const context: Context = {
  messages: [{ content: "hi", role: "user", timestamp: currentTimeMillis() }],
};

function envKeyAuth(key: string | undefined): ApiKeyAuth {
  return {
    name: "Test API key",
    resolve: ({ credential }) => {
      const resolved = credential?.key ?? key;
      if (resolved === undefined || resolved === "") return Promise.resolve(undefined);
      return Promise.resolve({
        auth: { apiKey: resolved },
        source: credential === undefined ? "env" : "stored",
      });
    },
  };
}

function testOAuth(overrides?: Partial<OAuthAuth>): OAuthAuth {
  return {
    login: () => Promise.reject(new Error("not used")),
    name: "Test OAuth",
    refresh: (credential) => Promise.resolve(credential),
    toAuth: (credential) => Promise.resolve({ apiKey: credential.access }),
    ...overrides,
  };
}

const storeCredential = (
  credentials: CredentialStore,
  providerId: string,
  credential: Credential,
): Effect.Effect<void> =>
  Effect.promise(() => credentials.modify(providerId, () => Promise.resolve(credential)));

const modelsRuntimeSupport = {
  ambientAuth,
  context,
  doneMessage,
  envKeyAuth,
  storeCredential,
  testModel,
  testOAuth,
  testProvider,
};

export default modelsRuntimeSupport;
