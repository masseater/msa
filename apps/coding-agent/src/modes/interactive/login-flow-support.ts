import oauthSelectorSupport from "./components/oauth-selector-support.ts";
import type oauthSelectorTypes from "./components/oauth-selector.types.ts";
import type loginFlowTypes from "./login-flow.types.ts";

const { formatAuthSelectorProviderType } = oauthSelectorSupport;
const AUTH_TYPE_ORDER = { api_key: 1, oauth: 0 } satisfies Record<
  oauthSelectorTypes.AuthSelectorProvider["authType"],
  number
>;
function getLoginProviderCompletionOptions(
  providerOptions: readonly oauthSelectorTypes.AuthSelectorProvider[],
): loginFlowTypes.LoginProviderCompletionOption[] {
  const byId = new Map<string, loginFlowTypes.LoginProviderCompletionOption>();
  for (const provider of providerOptions) {
    const existing = byId.get(provider.id);
    if (existing !== undefined) {
      if (!existing.authTypes.includes(provider.authType)) {
        existing.authTypes.push(provider.authType);
        existing.authTypes.sort((a, b) => AUTH_TYPE_ORDER[a] - AUTH_TYPE_ORDER[b]);
      }
      continue;
    }
    byId.set(provider.id, {
      authTypes: [provider.authType],
      id: provider.id,
      name: provider.name,
      subscription: provider.subscription,
    });
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}
function getLoginProviderSearchText(
  provider: loginFlowTypes.LoginProviderCompletionOption,
): string {
  const authTypes = provider.authTypes
    .map(
      (authType) =>
        `${authType} ${formatAuthSelectorProviderType(authType, provider.subscription)}`,
    )
    .join(" ");
  return `${provider.id} ${provider.name} ${authTypes}`;
}
function formatLoginProviderCompletionDescription(
  provider: loginFlowTypes.LoginProviderCompletionOption,
): string {
  const authTypes = provider.authTypes
    .map((authType) => formatAuthSelectorProviderType(authType, provider.subscription))
    .join("/");
  return provider.name === provider.id ? authTypes : `${provider.name} · ${authTypes}`;
}

const loginFlowSupport = {
  formatLoginProviderCompletionDescription,
  getLoginProviderCompletionOptions,
  getLoginProviderSearchText,
};

export default loginFlowSupport;
