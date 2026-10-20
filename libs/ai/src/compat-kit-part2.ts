import helpers from "./auth/helpers.ts";
import builtinApiProviders from "./builtin-api-providers.ts";
import envApiKeys from "./env-api-keys.ts";
import imageModels from "./image-models.ts";
import imagesApiRegistry from "./images-api-registry.ts";
import images from "./images.ts";
import legacyApiAliases from "./legacy-api-aliases.ts";
import legacyOpenaiApiAliases from "./legacy-openai-api-aliases.ts";
import InMemoryModelsStore from "./models-store.ts";

const compatKitPart2 = {
  InMemoryModelsStore,
  builtinApiProviders,
  envApiKeys,
  helpers,
  imageModels,
  images,
  imagesApiRegistry,
  legacyApiAliases,
  legacyOpenaiApiAliases,
};

export default compatKitPart2;
