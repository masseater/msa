import McpServerRegistry from "../mcp-server-registry.ts";
import type extensionsTypesTypes from "./types.types.ts";
const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().";

const notInitialized = () => {
  throw new Error(
    "Extension runtime not initialized. Action methods cannot be called during extension loading.",
  );
};

const pendingActions = () => ({
  appendEntry: notInitialized,
  createContext: notInitialized,
  getActiveTools: notInitialized,
  getAllTools: notInitialized,
  getCommands: notInitialized,
  getSessionName: notInitialized,
  getSettings: notInitialized,
  getThinkingLevel: notInitialized,
  refreshTools: () => {},
  sendMessage: notInitialized,
  sendUserMessage: notInitialized,
  setActiveTools: notInitialized,
  setLabel: notInitialized,
  setModel: () => Promise.reject(new Error("Extension runtime not initialized")),
  setSessionName: notInitialized,
  setThinkingLevel: notInitialized,
});

const lifecycle = () => {
  const state: { staleMessage?: string } = {};
  const eventBusUnsubscribers = new Set<() => void>();
  return {
    assertActive: () => {
      if (state.staleMessage !== undefined && state.staleMessage !== "") {
        throw new Error(state.staleMessage);
      }
    },
    invalidate: (message?: string) => {
      if (state.staleMessage !== undefined && state.staleMessage !== "") return;
      state.staleMessage = message ?? STALE_MESSAGE;
      for (const unsubscribe of eventBusUnsubscribers) unsubscribe();
      eventBusUnsubscribers.clear();
    },
    trackEventBusSubscription: (unsubscribe: () => void) => {
      let active = true;
      const trackedUnsubscribe = () => {
        if (!active) return;
        active = false;
        eventBusUnsubscribers.delete(trackedUnsubscribe);
        unsubscribe();
      };
      eventBusUnsubscribers.add(trackedUnsubscribe);
      return trackedUnsubscribe;
    },
  };
};

const registrations = (runtime: () => extensionsTypesTypes.ExtensionRuntime) => ({
  registerNativeProvider: (
    ...[provider, extensionPath = "<unknown>"]: Parameters<
      extensionsTypesTypes.ExtensionRuntime["registerNativeProvider"]
    >
  ) => {
    runtime().pendingNativeProviderRegistrations.push({ extensionPath, provider });
  },
  registerProvider: (
    ...[name, config, extensionPath = "<unknown>"]: Parameters<
      extensionsTypesTypes.ExtensionRuntime["registerProvider"]
    >
  ) => {
    runtime().pendingProviderRegistrations.push({ config, extensionPath, name });
  },
  registerVirtualModel: (
    ...[definition, extensionPath = "<unknown>"]: Parameters<
      extensionsTypesTypes.ExtensionRuntime["registerVirtualModel"]
    >
  ) => {
    runtime().pendingVirtualModelRegistrations.push({ definition, extensionPath });
  },
  unregisterProvider: (name: string) => {
    const current = runtime();
    current.pendingProviderRegistrations = current.pendingProviderRegistrations.filter(
      (r) => r.name !== name,
    );
    current.pendingNativeProviderRegistrations = current.pendingNativeProviderRegistrations.filter(
      (r) => r.provider.id !== name,
    );
  },
  unregisterVirtualModel: (provider: string, id: string) => {
    const current = runtime();
    current.pendingVirtualModelRegistrations = current.pendingVirtualModelRegistrations.filter(
      ({ definition }) => definition.provider !== provider || definition.id !== id,
    );
  },
});

function createExtensionRuntime(): extensionsTypesTypes.ExtensionRuntime {
  const runtime: extensionsTypesTypes.ExtensionRuntime = {
    ...pendingActions(),
    ...lifecycle(),
    ...registrations(() => runtime),
    flagValues: new Map(),
    mcpServers: new McpServerRegistry(),
    pendingNativeProviderRegistrations: [],
    pendingProviderRegistrations: [],
    pendingVirtualModelRegistrations: [],
  };
  return runtime;
}

const loaderRuntime = {
  createExtensionRuntime,
};

export default loaderRuntime;
