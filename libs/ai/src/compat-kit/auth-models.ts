import context from "../auth/context.ts";
import credentialStore from "../auth/credential-store.ts";
import helpers from "../auth/helpers.ts";
import envApiKeys from "../env-api-keys.ts";
import InMemoryModelsStore from "../models-store.ts";
import models from "../models.ts";
import all from "../providers/all.ts";
import sessionResources from "../session-resources.ts";

const authModelsKit: {
  readonly InMemoryModelsStore: typeof InMemoryModelsStore;
  readonly all: typeof all;
  readonly context: typeof context;
  readonly credentialStore: typeof credentialStore;
  readonly envApiKeys: typeof envApiKeys;
  readonly helpers: typeof helpers;
  readonly models: typeof models;
  readonly sessionResources: typeof sessionResources;
} = {
  InMemoryModelsStore,
  all,
  context,
  credentialStore,
  envApiKeys,
  helpers,
  models,
  sessionResources,
};

export default authModelsKit;
