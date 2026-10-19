import type { EventBus } from "../event-bus.ts";
import type { Extension, ExtensionRuntime } from "./types.ts";

export interface ApiScope {
  extension: Extension;
  runtime: ExtensionRuntime;
  cwd: string;
  eventBus: EventBus;
  assertActive: () => void;
  applyRuntimeChange: (change: () => void) => void;
  isLoading: () => boolean;
  pendingFlagValues: Map<string, boolean | string>;
  loadingUnsubscribers: Array<() => void>;
}

export type HandlerFn = (...args: unknown[]) => Promise<unknown>;
