declare namespace utilsTypes {
  interface FileOperations {
    read: Set<string>;
    written: Set<string>;
    edited: Set<string>;
  }
}

export type { utilsTypes as default };
