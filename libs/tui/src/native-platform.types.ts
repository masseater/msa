declare namespace nativePlatformTypes {
  type ModifierKey = "shift" | "command" | "control" | "option";

  interface NativeClipboard {
    getText(): Promise<string | null | undefined>;
    getImage(): Promise<Uint8Array | null | undefined>;
    getFilePaths?(): Promise<string[] | null | undefined>;
    setText?(text: string): Promise<void>;
  }
}

export type { nativePlatformTypes as default };
