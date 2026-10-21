const MAX_RENDER_WRITE_CHARS = 1024 * 1024;

export default class BoundedTerminalWriter {
  private buffer = "";
  private writtenChars = 0;
  private readonly write: (data: string) => void;

  constructor(write: (data: string) => void) {
    this.write = write;
  }

  append(value: string): void {
    let offset = 0;
    while (offset < value.length) {
      const capacity = MAX_RENDER_WRITE_CHARS - this.buffer.length;
      if (capacity === 0) {
        this.flush();
        continue;
      }

      let end = Math.min(value.length, offset + capacity);
      if (
        end < value.length &&
        value.charCodeAt(end - 1) >= 0xd800 &&
        value.charCodeAt(end - 1) <= 0xdbff &&
        value.charCodeAt(end) >= 0xdc00 &&
        value.charCodeAt(end) <= 0xdfff
      ) {
        end--;
      }
      if (end === offset) {
        this.flush();
        continue;
      }

      this.buffer += value.slice(offset, end);
      offset = end;
      if (this.buffer.length === MAX_RENDER_WRITE_CHARS) {
        this.flush();
      }
    }
  }

  flush(): void {
    if (this.buffer === "") return;
    this.write(this.buffer);
    this.writtenChars += this.buffer.length;
    this.buffer = "";
  }

  get length(): number {
    return this.writtenChars + this.buffer.length;
  }
}
