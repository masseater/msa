import type typesModule from "../types.types.ts";
import lazy from "./lazy.ts";

const { lazyApi } = lazy;

const googleGenerativeAIApi = (): typesModule.ProviderStreams =>
  lazyApi(() => import("./google-generative-ai.ts").then((module) => module.default));

const googleGenerativeAiLazy = {
  googleGenerativeAIApi,
};

export default googleGenerativeAiLazy;
