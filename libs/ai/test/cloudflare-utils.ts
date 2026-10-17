import { envValue } from "./env.ts";
export function hasCloudflareWorkersAICredentials(): boolean {
  return (
    envValue("CLOUDFLARE_API_KEY") !== undefined &&
    envValue("CLOUDFLARE_API_KEY") !== "" &&
    envValue("CLOUDFLARE_ACCOUNT_ID") !== undefined &&
    envValue("CLOUDFLARE_ACCOUNT_ID") !== ""
  );
}

export function hasCloudflareAiGatewayCredentials(): boolean {
  return (
    envValue("CLOUDFLARE_API_KEY") !== undefined &&
    envValue("CLOUDFLARE_API_KEY") !== "" &&
    envValue("CLOUDFLARE_ACCOUNT_ID") !== undefined &&
    envValue("CLOUDFLARE_ACCOUNT_ID") !== "" &&
    envValue("CLOUDFLARE_GATEWAY_ID") !== undefined &&
    envValue("CLOUDFLARE_GATEWAY_ID") !== ""
  );
}
