declare namespace autocompleteHelpersTypes {
  type FolderStructure = {
    dirs?: string[];
    files?: Record<string, string>;
  };

  interface TempWorkspace {
    rootDir: string;
    baseDir: string;
    outsideDir: string;
  }
}

export type { autocompleteHelpersTypes as default };
