import compat from "../src/compat.ts";
import InMemoryModelsStore from "../src/models-store.ts";
import models from "../src/models.ts";

const modelTypesKit: {
  InMemoryModelsStore: typeof InMemoryModelsStore;
  compat: typeof compat;
  models: typeof models;
} = {
  InMemoryModelsStore,
  compat,
  models,
};

export default modelTypesKit;
