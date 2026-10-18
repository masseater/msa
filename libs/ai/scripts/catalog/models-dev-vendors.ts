import type { Api, Model } from "../../src/types.ts";
import { directModels, mistralModels } from "./models-dev-direct.ts";
import { googleModels } from "./models-dev-google.ts";
import { kimiCodingModels, moonshotModels } from "./models-dev-kimi.ts";
import { zaiModels } from "./models-dev-partners.ts";
import { minimaxModels, qwenTokenPlanModels, xiaomiModels } from "./models-dev-regional.ts";
import type { ModelsDevSource } from "./models-dev.ts";

const VENDOR_LOADERS: readonly ((source: ModelsDevSource) => Model<Api>[])[] = [
  directModels,
  googleModels,
  zaiModels,
  mistralModels,
  minimaxModels,
  kimiCodingModels,
  moonshotModels,
  xiaomiModels,
  qwenTokenPlanModels,
];

export function vendorModels(source: ModelsDevSource): Model<Api>[] {
  return VENDOR_LOADERS.flatMap((load) => load(source));
}
