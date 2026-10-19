import { Effect } from "effect";

import { fromPromise, pathOperations } from "../platform/index.ts";
import type { GrepOperations, RgMatch } from "./grep-support.ts";
import { truncateLine } from "./truncate.ts";

export interface GrepFormatterOptions {
  ops: GrepOperations;
  searchPath: string;
  isDirectory: boolean;
  contextValue: number;
}

export class GrepFormatter {
  linesTruncated = false;
  private readonly fileCache = new Map<string, string[]>();
  private readonly options: GrepFormatterOptions;

  constructor(options: GrepFormatterOptions) {
    this.options = options;
  }

  formatPath(filePath: string): string {
    if (this.options.isDirectory) {
      const relative = pathOperations.relative(this.options.searchPath, filePath);
      if (relative !== "" && !relative.startsWith("..")) {
        return relative.replace(/\\/gu, "/");
      }
    }
    return pathOperations.basename(filePath);
  }

  formatMatch(match: RgMatch): Effect.Effect<string[]> {
    if (this.options.contextValue === 0 && match.lineText !== undefined) {
      const sanitized = match.lineText
        .replace(/\r\n/gu, "\n")
        .replace(/\r/gu, "")
        .replace(/\n$/u, "");
      const { text, wasTruncated } = truncateLine(sanitized);
      if (wasTruncated) this.linesTruncated = true;
      return Effect.succeed([`${this.formatPath(match.filePath)}:${match.lineNumber}: ${text}`]);
    }
    return this.formatBlock(match.filePath, match.lineNumber);
  }

  private getFileLines(filePath: string): Effect.Effect<string[]> {
    const cached = this.fileCache.get(filePath);
    if (cached !== undefined) return Effect.succeed(cached);
    return fromPromise(() => this.options.ops.readFile(filePath)).pipe(
      Effect.map((content) => content.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n")),
      Effect.orElseSucceed((): string[] => []),
      Effect.tap((lines) => Effect.sync(() => this.fileCache.set(filePath, lines))),
    );
  }

  private formatBlock(filePath: string, lineNumber: number): Effect.Effect<string[]> {
    const { contextValue } = this.options;
    const relativePath = this.formatPath(filePath);
    return this.getFileLines(filePath).pipe(
      Effect.map((lines) => {
        if (lines.length === 0) return [`${relativePath}:${lineNumber}: (unable to read file)`];
        const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
        const end =
          contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;
        const block: string[] = [];
        for (let current = start; current <= end; current++) {
          const { text, wasTruncated } = truncateLine(
            (lines[current - 1] ?? "").replace(/\r/gu, ""),
          );
          if (wasTruncated) this.linesTruncated = true;
          block.push(
            current === lineNumber
              ? `${relativePath}:${current}: ${text}`
              : `${relativePath}-${current}- ${text}`,
          );
        }
        return block;
      }),
    );
  }
}
