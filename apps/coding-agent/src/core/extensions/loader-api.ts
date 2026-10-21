import loaderApiProviders from "./loader-api-providers.ts";
import loaderApiRegistration from "./loader-api-registration.ts";
import loaderApiSession from "./loader-api-session.ts";
import type loaderApiTypes from "./loader-api.types.ts";
import ExtensionApiLifecycle from "./loader-lifecycle.ts";
import type loaderScopeTypes from "./loader-scope.ts";
import type extensionsTypesTypes from "./types.types.ts";
const { eventMembers, messageMembers, stateMembers } = loaderApiSession;
const { flagMembers, rendererMembers, toolAndCommandMembers } = loaderApiRegistration;
const { mcpMembers, providerMembers } = loaderApiProviders;

function createExtensionAPI({
  extension,
  runtime,
  cwd,
  eventBus,
}: loaderApiTypes.ExtensionApiInput): {
  api: extensionsTypesTypes.ExtensionAPI;
  commit: () => void;
  discard: () => void;
} {
  const lifecycle = new ExtensionApiLifecycle(runtime);
  const scope: loaderScopeTypes.ApiScope = {
    applyRuntimeChange: (change) => lifecycle.applyRuntimeChange(change),
    assertActive: () => {
      if (lifecycle.isFailed()) {
        throw new Error(
          `Extension "${extension.path}" failed to load and its API is no longer active.`,
        );
      }
      runtime.assertActive();
    },
    cwd,
    eventBus,
    extension,
    isLoading: () => lifecycle.isLoading(),
    loadingUnsubscribers: lifecycle.loadingUnsubscribers,
    pendingFlagValues: lifecycle.pendingFlagValues,
    runtime,
  };

  const api = {
    ...eventMembers(scope),
    ...toolAndCommandMembers(scope),
    ...flagMembers(scope),
    ...rendererMembers(scope),
    ...messageMembers(scope),
    ...stateMembers(scope),
    ...providerMembers(scope),
    ...mcpMembers(scope),
  } as extensionsTypesTypes.ExtensionAPI;

  return { api, commit: () => lifecycle.commit(), discard: () => lifecycle.discard() };
}

const loaderApi = {
  createExtensionAPI,
};

export default loaderApi;
