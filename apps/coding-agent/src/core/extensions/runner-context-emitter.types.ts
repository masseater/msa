import type ContextEmitterClass from "./runner-context-emitter.ts";

declare namespace runnerContextEmitterTypes {
  type ContextEmitter = (typeof ContextEmitterClass)["prototype"];

  interface DiscoveredPath {
    path: string;
    extensionPath: string;
  }

  interface DiscoveredResources {
    skillPaths: DiscoveredPath[];
    promptPaths: DiscoveredPath[];
    themePaths: DiscoveredPath[];
  }
}

export type { runnerContextEmitterTypes as default };
