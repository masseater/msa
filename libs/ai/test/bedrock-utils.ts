import { envValue } from "./env.ts";
export function hasBedrockCredentials(): boolean {
  return !!(
    envValue("AWS_PROFILE") ||
    (envValue("AWS_ACCESS_KEY_ID") && envValue("AWS_SECRET_ACCESS_KEY")) ||
    envValue("AWS_BEARER_TOKEN_BEDROCK")
  );
}
