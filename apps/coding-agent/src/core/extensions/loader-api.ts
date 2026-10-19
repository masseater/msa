import type { EventBus } from "../event-bus.ts";
import { mcpMembers, providerMembers } from "./loader-api-providers.ts";
import { flagMembers, rendererMembers, toolAndCommandMembers } from "./loader-api-registration.ts";
import { eventMembers, messageMembers, stateMembers } from "./loader-api-session.ts";
import { ExtensionApiLifecycle } from "./loader-lifecycle.ts";
import type { ApiScope } from "./loader-scope.ts";
import type { Extension, ExtensionAPI, ExtensionRuntime } from "./types.ts";

export interface ExtensionApiInput {
  extension: Extension;
  runtime: ExtensionRuntime;
  cwd: string;
  eventBus: EventBus;
}

export function createExtensionAPI({ extension, runtime, cwd, eventBus }: ExtensionApiInput): {
  api: ExtensionAPI;
  commit: () => void;
  discard: () => void;
} {
  const lifecycle = new ExtensionApiLifecycle(runtime);
  const scope: ApiScope = {
    extension,
    runtime,
    cwd,
    eventBus,
    pendingFlagValues: lifecycle.pendingFlagValues,
    loadingUnsubscribers: lifecycle.loadingUnsubscribers,
    isLoading: () => lifecycle.isLoading(),
    applyRuntimeChange: (change) => lifecycle.applyRuntimeChange(change),
    assertActive: () => {
      if (lifecycle.isFailed()) {
        throw new Error(
          `Extension "${extension.path}" failed to load and its API is no longer active.`,
        );
      }
      runtime.assertActive();
    },
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
  } as ExtensionAPI;

  return { api, commit: () => lifecycle.commit(), discard: () => lifecycle.discard() };
}
