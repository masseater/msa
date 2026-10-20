export default class DiffWriter {
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
