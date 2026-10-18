import { Effect } from "effect";

import type { Api, Model } from "../../src/types.ts";
import { cloudflareAiGatewayModels } from "./models-dev-cloudflare.ts";
import { fireworksModels } from "./models-dev-fireworks.ts";
import { openCodeModels } from "./models-dev-opencode.ts";
import { basetenModels } from "./models-dev-partners.ts";
import type { ModelsDevSource } from "./models-dev.ts";
import { nvidiaModels } from "./nvidia.ts";
import { togetherModels } from "./together.ts";

const PLATFORM_LOADERS: readonly ((source: ModelsDevSource) => Model<Api>[])[] = [
  cloudflareAiGatewayModels,
  fireworksModels,
  togetherModels,
  basetenModels,
  openCodeModels,
];

export const platformModels = Effect.fn("platformModels")(function* (source: ModelsDevSource) {
  const nvidia = yield* nvidiaModels(source);
  return [...PLATFORM_LOADERS.flatMap((load) => load(source)), ...nvidia];
});
