declare namespace loaderDiscoveryTypes {
  interface DiscoveryInput {
    configuredPaths: string[];
    cwd: string;
    agentDir?: string;
  }
}

export type { loaderDiscoveryTypes as default };
