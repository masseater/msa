declare namespace tempDirTypes {
  interface TempDir {
    path: string;
  }

  interface AgentDir {
    agentDir: string;
    path: string;
  }

  interface ExtensionsDir {
    extensionsDir: string;
    path: string;
  }
}

export type { tempDirTypes as default };
