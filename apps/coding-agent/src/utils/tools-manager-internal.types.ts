declare namespace toolsManagerInternalTypes {
  interface ToolConfig {
    name: string;
    repo: string;
    binaryName: string;
    systemBinaryNames?: string[];
    tagPrefix: string;
    getAssetName: (version: string, plat: string, architecture: string) => string | null;
  }
}

export type { toolsManagerInternalTypes as default };
