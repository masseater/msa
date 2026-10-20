declare namespace clipboardImageTypes {
  type ClipboardImage = {
    bytes: Uint8Array;
    mimeType: string;
  };
}

export type { clipboardImageTypes as default };
