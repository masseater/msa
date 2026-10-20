import type aiTypes from "@msa/ai/index.types";

import type modelConfigTypes from "./model-config.types.ts";
import providerComposerPart2 from "./provider-composer-part2.ts";
import type providerComposerTypes from "./provider-composer.types.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";

const {
  getConfigValueEnvVarNames,
  isCommandConfigValue,
  isConfigValueConfigured,
  resolveHeadersOrThrow,
} = resolveConfigValueModule;
const { configuredApiKey, configuredHeaders, rawModelHeaders } = providerComposerPart2;

function resolveConfiguredModelHeaders(
  model: aiTypes.AnyModel,
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
  env?: Record<string, string>,
): Record<string, string> | undefined {
  return resolveHeadersOrThrow(
    rawModelHeaders(model, config, extension),
    `model "${model.provider}/${model.id}"`,
    env,
  );
}

function resolveCompatibilityRequestConfig(
  model: aiTypes.AnyModel,
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): providerComposerTypes.CompatibilityRequestConfig {
  const configured = resolveHeadersOrThrow(
    { ...configuredHeaders(config, extension), ...rawModelHeaders(model, config, extension) },
    `model "${model.provider}/${model.id}"`,
  );
  return {
    authHeader: extension?.authHeader ?? config?.authHeader ?? false,
    headers:
      model.headers !== undefined || configured !== undefined
        ? { ...model.headers, ...configured }
        : undefined,
  };
}

function configuredRequestAuthStatus(
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): providerComposerTypes.AuthStatus | undefined {
  const value = configuredApiKey(config, extension);
  if (value === undefined) return undefined;
  if (isCommandConfigValue(value)) return { configured: true, source: "models_json_command" };
  const names = getConfigValueEnvVarNames(value);
  if (names.length > 0) {
    return isConfigValueConfigured(value)
      ? { configured: true, label: names.join(", "), source: "environment" }
      : { configured: false };
  }
  return {
    configured: true,
    source: extension?.apiKey === undefined ? "models_json_key" : "fallback",
  };
}

const providerComposerPart4 = {
  configuredRequestAuthStatus,
  resolveCompatibilityRequestConfig,
  resolveConfiguredModelHeaders,
};

export default providerComposerPart4;
