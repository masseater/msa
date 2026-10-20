import { type BuiltinProvider, getModels } from "../src/compat.ts";
import type { Api, Model } from "../src/types.ts";

type CatalogModel<TProvider extends BuiltinProvider> = ReturnType<
  typeof getModels<TProvider>
>[number];

const price = (model: { readonly cost: { readonly input: number; readonly output: number } }) =>
  model.cost.input + model.cost.output;

const modelsWhere = <TProvider extends BuiltinProvider>(
  provider: TProvider,
  accepts: (model: CatalogModel<TProvider>) => boolean,
): CatalogModel<TProvider>[] =>
  getModels(provider)
    .filter(accepts)
    .toSorted((a, b) => price(a) - price(b) || a.id.localeCompare(b.id));

function chooseModel<TProvider extends BuiltinProvider, TModel extends CatalogModel<TProvider>>(
  provider: TProvider,
  wanted: string,
  accepts: (model: CatalogModel<TProvider>) => model is TModel,
): TModel;
function chooseModel<TProvider extends BuiltinProvider>(
  provider: TProvider,
  wanted: string,
  accepts?: (model: CatalogModel<TProvider>) => boolean,
): CatalogModel<TProvider>;
function chooseModel<TProvider extends BuiltinProvider>(
  provider: TProvider,
  wanted: string,
  accepts: (model: CatalogModel<TProvider>) => boolean = () => true,
): CatalogModel<TProvider> {
  const [model] = modelsWhere(provider, accepts);
  if (model === undefined) throw new Error(`The ${provider} catalog has no ${wanted} model`);
  return model;
}

const compatValue = (model: { readonly compat?: object | undefined }, name: string): unknown =>
  (model.compat as Readonly<Record<string, unknown>> | undefined)?.[name];

const usesApi =
  <TApi extends Api>(api: TApi) =>
  (model: Model<Api>): model is Model<TApi> =>
    model.api === api;

const modelChoice = { chooseModel, compatValue, modelsWhere, usesApi };

export default modelChoice;
