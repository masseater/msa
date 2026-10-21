declare namespace truncateTypes {
  interface TruncationResult {
    content: string;
    truncated: boolean;
    truncatedBy: "lines" | "bytes" | null;
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    lastLinePartial: boolean;
    firstLineExceedsLimit: boolean;
    maxLines: number;
    maxBytes: number;
  }

  interface TruncationOptions {
    maxLines?: number;
    maxBytes?: number;
  }
}

export type { truncateTypes as default };
