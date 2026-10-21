import platform from "../../core/platform/index.ts";

const { appendText, fileSize, makeDirectory, rename } = platform.files;

const { dirname, nowMs, toDate } = platform;

const MAX_LOG_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatData(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data) ?? String(data);
  } catch {
    return String(data);
  }
}

function formatMcpLogMessage(server: string, params: unknown, now: Date = toDate(nowMs())): string {
  const message = isRecord(params) ? params : { data: params };
  const level = typeof message["level"] === "string" ? message["level"] : "info";
  const logger =
    typeof message["logger"] === "string" && message["logger"] !== ""
      ? ` ${message["logger"]}:`
      : "";
  const text = formatData(message["data"]).replace(/\r?\n/gu, "\n    ");
  return `${now.toISOString()} [${server}] ${level}${logger} ${text}\n`;
}

export default class McpServerLog {
  readonly path: string;
  private size: number | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  write(server: string, params: unknown): void {
    const line = formatMcpLogMessage(server, params);
    this.pending = this.pending.then(() => this.append(line)).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.pending;
  }

  private append(line: string): Promise<void> {
    return this.knownSize()
      .then((size) => (size > MAX_LOG_BYTES ? this.rotate() : size))
      .then((size) =>
        appendText({ data: line, path: this.path }).then(() => {
          this.size = size + Buffer.byteLength(line);
          return undefined;
        }),
      );
  }

  private knownSize(): Promise<number> {
    if (this.size !== undefined) return Promise.resolve(this.size);
    return makeDirectory({ path: dirname(this.path) }).then(() => this.currentSize());
  }

  private rotate(): Promise<number> {
    return this.currentSize()
      .then((size) =>
        size > MAX_LOG_BYTES ? rename({ from: this.path, to: `${this.path}.1` }) : undefined,
      )
      .then(() => this.currentSize());
  }

  private currentSize(): Promise<number> {
    return fileSize(this.path).catch(() => 0);
  }
}
