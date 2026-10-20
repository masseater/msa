import modelsAuthApply from "./models-auth-apply.ts";
import modelsAuth from "./models-auth.ts";
import modelsCatalogQuery from "./models-catalog-query.ts";
import modelsCost from "./models-cost.ts";
import modelsProvider from "./models-provider.ts";
import modelsRefresh from "./models-refresh.ts";
import modelsStream from "./models-stream.ts";

const modelsParts: {
  readonly modelsAuth: typeof modelsAuth;
  readonly modelsAuthApply: typeof modelsAuthApply;
  readonly modelsCatalogQuery: typeof modelsCatalogQuery;
  readonly modelsCost: typeof modelsCost;
  readonly modelsProvider: typeof modelsProvider;
  readonly modelsRefresh: typeof modelsRefresh;
  readonly modelsStream: typeof modelsStream;
} = {
  modelsAuth,
  modelsAuthApply,
  modelsCatalogQuery,
  modelsCost,
  modelsProvider,
  modelsRefresh,
  modelsStream,
};

export default modelsParts;
