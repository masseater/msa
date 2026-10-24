import compatModule from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import type typesModule from "../src/types.types.ts";

const { getModels } = compatModule;

type CatalogModel<TProvider extends compatTypes.BuiltinProvider> = ReturnType<
  typeof getModels<TProvider>
>[number];

type PricedModel = {
  readonly cost: { readonly input: number; readonly output: number };
  readonly id: string;
};

const price = (model: PricedModel) => model.cost.input + model.cost.output;

const byPrice = <TModel extends PricedModel>(models: readonly TModel[]): TModel[] =>
  models.toSorted((a, b) => price(a) - price(b) || a.id.localeCompare(b.id));

const modelsWhere = <TProvider extends compatTypes.BuiltinProvider>(
  provider: TProvider,
  accepts: (model: CatalogModel<TProvider>) => boolean,
): CatalogModel<TProvider>[] => byPrice(getModels(provider).filter(accepts));

const CHATGPT_ACCOUNT_REJECTED_MODELS: Readonly<Record<string, readonly string[]>> = {
  "openai-codex": ["gpt-5.3-codex-spark", "gpt-5.5"],
};

const cheapestUsable = <TModel extends PricedModel & { readonly provider: string }>(
  models: readonly TModel[],
): TModel | undefined =>
  byPrice(models).find(
    (model) => !(CHATGPT_ACCOUNT_REJECTED_MODELS[model.provider] ?? []).includes(model.id),
  );

function chooseModel<
  TProvider extends compatTypes.BuiltinProvider,
  TModel extends CatalogModel<TProvider>,
>(
  provider: TProvider,
  wanted: string,
  accepts: (model: CatalogModel<TProvider>) => model is TModel,
): TModel;
function chooseModel<TProvider extends compatTypes.BuiltinProvider>(
  provider: TProvider,
  wanted: string,
  accepts?: (model: CatalogModel<TProvider>) => boolean,
): CatalogModel<TProvider>;
function chooseModel<TProvider extends compatTypes.BuiltinProvider>(
  provider: TProvider,
  wanted: string,
  accepts: (model: CatalogModel<TProvider>) => boolean = () => true,
): CatalogModel<TProvider> {
  const model = cheapestUsable(getModels(provider).filter(accepts));
  if (model === undefined) throw new Error(`The ${provider} catalog has no ${wanted} model`);
  return model;
}

const compatValue = (model: { readonly compat?: object | undefined }, name: string): unknown =>
  (model.compat as Readonly<Record<string, unknown>> | undefined)?.[name];

const usesApi =
  <TApi extends typesModule.Api>(api: TApi) =>
  (model: typesModule.Model<typesModule.Api>): model is typesModule.Model<TApi> =>
    model.api === api;

const modelChoice = {
  CHATGPT_ACCOUNT_REJECTED_MODELS,
  cheapestUsable,
  chooseModel,
  compatValue,
  modelsWhere,
  usesApi,
};

export default modelChoice;
