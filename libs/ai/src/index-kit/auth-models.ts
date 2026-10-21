import lazy from "../api/lazy.ts";
import context from "../auth/context.ts";
import credentialStore from "../auth/credential-store.ts";
import helpers from "../auth/helpers.ts";
import InMemoryModelsStore from "../models-store.ts";
import models from "../models.ts";
import sessionResources from "../session-resources.ts";

const authModelsKit: {
  readonly InMemoryModelsStore: typeof InMemoryModelsStore;
  readonly context: typeof context;
  readonly credentialStore: typeof credentialStore;
  readonly helpers: typeof helpers;
  readonly lazy: typeof lazy;
  readonly models: typeof models;
  readonly sessionResources: typeof sessionResources;
} = {
  InMemoryModelsStore,
  context,
  credentialStore,
  helpers,
  lazy,
  models,
  sessionResources,
};

export default authModelsKit;
