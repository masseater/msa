import lazy from "./api/lazy.ts";
import context from "./auth/context.ts";
import credentialStore from "./auth/credential-store.ts";
import helpers from "./auth/helpers.ts";
import InMemoryModelsStore from "./models-store.ts";
import models from "./models.ts";
import fauxCore from "./providers/faux-core.ts";
import fauxMessages from "./providers/faux-messages.ts";
import faux from "./providers/faux.ts";

const indexKitPart1 = {
  InMemoryModelsStore,
  context,
  credentialStore,
  faux,
  fauxCore,
  fauxMessages,
  helpers,
  lazy,
  models,
};

export default indexKitPart1;
