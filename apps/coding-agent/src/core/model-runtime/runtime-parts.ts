import configModule from "../../config.ts";
import DefaultAuthStorage from "../auth-storage.ts";
import FileModelsStore from "../file-models-store.ts";
import InMemoryCodingAgentModelsStore from "../in-memory-coding-agent-models-store.ts";
import ModelConfig from "../model-config.ts";
import type modelRuntimeTypes from "../model-runtime.types.ts";
import platform from "../platform/index.ts";
import RuntimeCredentials from "../runtime-credentials.ts";
import catalogProviders from "./catalog-providers.ts";

const { dirname, join, readEnv } = platform;
const { getModelsPath } = configModule;
const { builtinCatalogProviders } = catalogProviders;

const modelsStoreFor = (
  options: modelRuntimeTypes.CreateModelRuntimeOptions,
  modelsPath: string | undefined,
) =>
  options.modelsStore ??
  (modelsPath !== undefined && modelsPath !== ""
    ? new FileModelsStore(options.modelsStorePath ?? join(dirname(modelsPath), "models-store.json"))
    : new InMemoryCodingAgentModelsStore());

const loadRuntimeParts = (options: modelRuntimeTypes.CreateModelRuntimeOptions) => {
  const modelsPath =
    options.modelsPath === null ? undefined : (options.modelsPath ?? getModelsPath());
  return ModelConfig.load(modelsPath).then((config) => ({
    catalogProviders: builtinCatalogProviders(options.catalogBaseUrl),
    config,
    credentials: new RuntimeCredentials(
      options.credentials ?? DefaultAuthStorage.create(options.authPath),
    ),
    modelNetworkEnabled: readEnv("MSA_OFFLINE") === undefined,
    modelsPath,
    modelsStore: modelsStoreFor(options, modelsPath),
  }));
};

const runtimeParts = { loadRuntimeParts };

export default runtimeParts;
