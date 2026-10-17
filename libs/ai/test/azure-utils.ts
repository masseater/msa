import { envValue, hasEnv } from "./env.ts";
function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (value === undefined || value === "") return map;
  for (const entry of value.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const [modelId, deploymentName] = trimmed.split("=", 2);
    if (
      modelId === undefined ||
      modelId === "" ||
      deploymentName === undefined ||
      deploymentName === ""
    )
      continue;
    map.set(modelId.trim(), deploymentName.trim());
  }
  return map;
}

export function hasAzureOpenAICredentials(): boolean {
  const hasKey = hasEnv("AZURE_OPENAI_API_KEY");
  const hasBaseUrl = hasEnv("AZURE_OPENAI_BASE_URL") || hasEnv("AZURE_OPENAI_RESOURCE_NAME");
  return hasKey && hasBaseUrl;
}

export function resolveAzureDeploymentName(modelId: string): string | undefined {
  const mapValue = envValue("AZURE_OPENAI_DEPLOYMENT_NAME_MAP");
  if (mapValue === undefined || mapValue === "") return undefined;
  return parseDeploymentNameMap(mapValue).get(modelId);
}
