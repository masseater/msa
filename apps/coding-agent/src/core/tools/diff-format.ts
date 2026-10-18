import * as Diff from "diff";
import { dual } from "effect/Function";

export interface EditDiffResult {
  diff: string;
  firstChangedLine: number | undefined;
}

export const generateUnifiedPatch: {
  (oldContent: string, newContent: string, contextLines?: number): (path: string) => string;
  (path: string, oldContent: string, newContent: string, contextLines?: number): string;
} = dual(
  (args) => typeof args[2] === "string",
  (path: string, oldContent: string, newContent: string, contextLines = 4): string =>
    Diff.createTwoFilesPatch(path, path, oldContent, newContent, undefined, undefined, {
      context: contextLines,
      headerOptions: Diff.FILE_HEADERS_ONLY,
    }),
);

class DiffWriter {
  readonly output: string[] = [];
  oldLineNum = 1;
  newLineNum = 1;
  private readonly width: number;

  constructor(width: number) {
    this.width = width;
  }

  padded(lineNum: number): string {
    return String(lineNum).padStart(this.width, " ");
  }

  added(lines: string[]): void {
    for (const line of lines) {
      this.output.push(`+${this.padded(this.newLineNum)} ${line}`);
      this.newLineNum++;
    }
  }

  removed(lines: string[]): void {
    for (const line of lines) {
      this.output.push(`-${this.padded(this.oldLineNum)} ${line}`);
      this.oldLineNum++;
    }
  }

  context(lines: string[]): void {
    for (const line of lines) {
      this.output.push(` ${this.padded(this.oldLineNum)} ${line}`);
      this.oldLineNum++;
      this.newLineNum++;
    }
  }

  skip(count: number): void {
    this.output.push(` ${"".padStart(this.width, " ")} ...`);
    this.oldLineNum += count;
    this.newLineNum += count;
  }
}

function writeUnchanged(
  writer: DiffWriter,
  raw: string[],
  position: { leading: boolean; trailing: boolean },
  contextLines: number,
): void {
  if (position.leading && position.trailing) {
    if (raw.length <= contextLines * 2) {
      writer.context(raw);
      return;
    }
    writer.context(raw.slice(0, contextLines));
    writer.skip(raw.length - contextLines * 2);
    writer.context(raw.slice(raw.length - contextLines));
    return;
  }
  if (position.leading) {
    writer.context(raw.slice(0, contextLines));
    const skipped = raw.length - Math.min(raw.length, contextLines);
    if (skipped > 0) writer.skip(skipped);
    return;
  }
  if (position.trailing) {
    const skipped = Math.max(0, raw.length - contextLines);
    if (skipped > 0) writer.skip(skipped);
    writer.context(raw.slice(skipped));
    return;
  }
  writer.oldLineNum += raw.length;
  writer.newLineNum += raw.length;
}

function generateDiffStringImpl(
  oldContent: string,
  newContent: string,
  contextLines = 4,
): EditDiffResult {
  const parts = Diff.diffLines(oldContent, newContent);
  const maxLineNum = Math.max(oldContent.split("\n").length, newContent.split("\n").length);
  const writer = new DiffWriter(String(maxLineNum).length);
  let lastWasChange = false;
  let firstChangedLine: number | undefined;

  for (const [i, part] of parts.entries()) {
    const raw = part.value.split("\n");
    if (raw.at(-1) === "") raw.pop();

    if (part.added || part.removed) {
      firstChangedLine ??= writer.newLineNum;
      if (part.added) writer.added(raw);
      else writer.removed(raw);
      lastWasChange = true;
      continue;
    }
    const nextPart = parts[i + 1];
    const trailing = nextPart !== undefined && (nextPart.added || nextPart.removed);
    writeUnchanged(writer, raw, { leading: lastWasChange, trailing }, contextLines);
    lastWasChange = false;
  }
  return { diff: writer.output.join("\n"), firstChangedLine };
}

export const generateDiffString: {
  (newContent: string, contextLines?: number): (oldContent: string) => EditDiffResult;
  (oldContent: string, newContent: string, contextLines?: number): EditDiffResult;
} = dual((args) => typeof args[1] === "string", generateDiffStringImpl);
