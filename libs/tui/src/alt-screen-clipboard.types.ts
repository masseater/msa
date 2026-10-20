declare namespace altScreenClipboardTypes {
  interface ClipboardTarget {
    copySelection: ((text: string) => Promise<boolean | string>) | undefined;
    write(data: string): void;
    flash(message: string, durationMs?: number): void;
  }
}

export type { altScreenClipboardTypes as default };
