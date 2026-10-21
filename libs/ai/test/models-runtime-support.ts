import { Effect } from "effect";

import type typesModuleModule from "../src/auth/types.ts";
import type modelsTypes from "../src/models.types.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import eventStream from "../src/utils/event-stream.ts";

const { currentTimeMillis } = clock;
const { AssistantMessageEventStream } = eventStream;

interface ProviderCall {
  model: typesModule.Model<typesModule.Api>;
  options: typesModule.StreamOptions | undefined;
}

function testModel(provider: string, id: string): typesModule.Model<typesModule.Api> {
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

function doneMessage(
  model: typesModule.Model<typesModule.Api>,
  text: string,
): typesModule.AssistantMessage {
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

const ambientAuth: typesModuleModule.ApiKeyAuth = {
  name: "Ambient",
  resolve: () => Promise.resolve({ auth: {} }),
};

function testProvider(input: {
  id: string;
  models?: typesModule.Model<typesModule.Api>[];
  auth?: typesModuleModule.ProviderAuth;
  getModels?: () => readonly typesModule.Model<typesModule.Api>[];
  refreshModels?: modelsTypes.Provider["refreshModels"];
  calls?: ProviderCall[];
}): modelsTypes.Provider {
  const models = input.models ?? [testModel(input.id, "model-a")];
  const respond = (
    model: typesModule.Model<typesModule.Api>,
    options: typesModule.StreamOptions | undefined,
  ) => {
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
    stream: (model, _context, options) =>
      respond(model, options as typesModule.StreamOptions | undefined),
    streamSimple: (model, _context, options) =>
      respond(model, options as typesModule.SimpleStreamOptions | undefined),
    ...(input.refreshModels === undefined ? {} : { refreshModels: input.refreshModels }),
  };
}

const context: typesModule.Context = {
  messages: [{ content: "hi", role: "user", timestamp: currentTimeMillis() }],
};

function envKeyAuth(key: string | undefined): typesModuleModule.ApiKeyAuth {
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

function testOAuth(overrides?: Partial<typesModuleModule.OAuthAuth>): typesModuleModule.OAuthAuth {
  return {
    login: () => Promise.reject(new Error("not used")),
    name: "Test OAuth",
    refresh: (credential) => Promise.resolve(credential),
    toAuth: (credential) => Promise.resolve({ apiKey: credential.access }),
    ...overrides,
  };
}

const storeCredential = (
  credentials: typesModuleModule.CredentialStore,
  providerId: string,
  credential: typesModuleModule.Credential,
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
