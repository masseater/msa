import { dual } from "effect/Function";

import themeModule from "../theme/theme.ts";
import type oauthSelectorTypes from "./oauth-selector.types.ts";

const { theme } = themeModule;
const formatAuthSelectorProviderType: {
  (
    subscription?: boolean,
  ): (authType: oauthSelectorTypes.AuthSelectorProvider["authType"]) => string;
  (authType: oauthSelectorTypes.AuthSelectorProvider["authType"], subscription?: boolean): string;
} = dual(
  (args) => typeof args[0] === "string",
  (
    authType: oauthSelectorTypes.AuthSelectorProvider["authType"],
    subscription?: boolean,
  ): string => {
    if (authType === "api_key") return "API key";
    return subscription === false ? "account" : "subscription";
  },
);
function formatAuthSelectorProviderStatus(
  provider: oauthSelectorTypes.AuthSelectorProvider,
): string {
  if (provider.status === undefined) return theme.fg("muted", " • not configured");
  if (provider.status.type !== provider.authType) {
    const label = `${formatAuthSelectorProviderType(provider.status.type, provider.subscription)} configured`;
    return theme.fg("muted", " • ") + theme.fg("warning", label);
  }
  if (
    provider.status.source === undefined ||
    provider.status.source === "" ||
    provider.status.source === "OAuth" ||
    provider.status.source === "stored credential"
  ) {
    return theme.fg("success", " ✓ configured");
  }
  const source = /^[A-Z][A-Z0-9_]*(?:, [A-Z][A-Z0-9_]*)*$/u.test(provider.status.source)
    ? `env: ${provider.status.source}`
    : provider.status.source;
  return theme.fg("success", ` ✓ ${source}`);
}

const oauthSelectorSupport = {
  formatAuthSelectorProviderStatus,
  formatAuthSelectorProviderType,
};

export default oauthSelectorSupport;
