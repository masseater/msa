declare namespace manifestTypes {
  interface MsaManifest {
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
  }
}

export type { manifestTypes as default };
