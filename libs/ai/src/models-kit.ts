import lazy from "./api/lazy.ts";
import context from "./auth/context.ts";
import credentialStore from "./auth/credential-store.ts";
import resolve from "./auth/resolve.ts";
import InMemoryModelsStore from "./models-store.ts";
import abort from "./utils/abort.ts";
import modelOperations from "./utils/model-operations.ts";
import modelsError from "./utils/models-error.ts";

const modelsKit = {
  InMemoryModelsStore,
  abort,
  context,
  credentialStore,
  lazy,
  modelOperations,
  modelsError,
  resolve,
};

export default modelsKit;
