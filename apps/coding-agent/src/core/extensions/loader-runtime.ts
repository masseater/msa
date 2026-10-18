import { McpServerRegistry } from "../mcp-servers.ts";
import type { ExtensionRuntime } from "./types.ts";

const STALE_MESSAGE =
  "This extension ctx is stale after session replacement or reload. Do not use a captured msa or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().";

const notInitialized = () => {
  throw new Error(
    "Extension runtime not initialized. Action methods cannot be called during extension loading.",
  );
};

const pendingActions = () => ({
  sendMessage: notInitialized,
  sendUserMessage: notInitialized,
  appendEntry: notInitialized,
  setSessionName: notInitialized,
  getSessionName: notInitialized,
  setLabel: notInitialized,
  getActiveTools: notInitialized,
  getAllTools: notInitialized,
  getSettings: notInitialized,
  setActiveTools: notInitialized,
  refreshTools: () => {},
  getCommands: notInitialized,
  setModel: () => Promise.reject(new Error("Extension runtime not initialized")),
  getThinkingLevel: notInitialized,
  setThinkingLevel: notInitialized,
  createContext: notInitialized,
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

const registrations = (runtime: () => ExtensionRuntime) => ({
  registerProvider: (
    ...[name, config, extensionPath = "<unknown>"]: Parameters<ExtensionRuntime["registerProvider"]>
  ) => {
    runtime().pendingProviderRegistrations.push({ name, config, extensionPath });
  },
  registerNativeProvider: (
    ...[provider, extensionPath = "<unknown>"]: Parameters<
      ExtensionRuntime["registerNativeProvider"]
    >
  ) => {
    runtime().pendingNativeProviderRegistrations.push({ provider, extensionPath });
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
  registerVirtualModel: (
    ...[definition, extensionPath = "<unknown>"]: Parameters<
      ExtensionRuntime["registerVirtualModel"]
    >
  ) => {
    runtime().pendingVirtualModelRegistrations.push({ definition, extensionPath });
  },
  unregisterVirtualModel: (provider: string, id: string) => {
    const current = runtime();
    current.pendingVirtualModelRegistrations = current.pendingVirtualModelRegistrations.filter(
      ({ definition }) => definition.provider !== provider || definition.id !== id,
    );
  },
});

export function createExtensionRuntime(): ExtensionRuntime {
  const runtime: ExtensionRuntime = {
    ...pendingActions(),
    ...lifecycle(),
    ...registrations(() => runtime),
    flagValues: new Map(),
    pendingProviderRegistrations: [],
    pendingNativeProviderRegistrations: [],
    mcpServers: new McpServerRegistry(),
    pendingVirtualModelRegistrations: [],
  };
  return runtime;
}
