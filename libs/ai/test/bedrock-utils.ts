import { hasEnv } from "./env.ts";
export function hasBedrockCredentials(): boolean {
  return (
    hasEnv("AWS_PROFILE") ||
    (hasEnv("AWS_ACCESS_KEY_ID") && hasEnv("AWS_SECRET_ACCESS_KEY")) ||
    hasEnv("AWS_BEARER_TOKEN_BEDROCK")
  );
}
