import platformNode from "../../core/platform-node.ts";
import platform from "../../core/platform.ts";
import nodeFs from "../../core/platform/node/fs.ts";

const { appendFileSync, mkdirSync, renameSync, statSync } = nodeFs;

const { nowMs, toDate } = platform;
const { dirname } = platformNode;

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

  constructor(path: string) {
    this.path = path;
  }

  write(server: string, params: unknown): void {
    const line = formatMcpLogMessage(server, params);
    try {
      if (this.size === undefined) {
        mkdirSync(dirname(this.path), { recursive: true });
        this.size = this.currentSize();
      }
      if (this.size > MAX_LOG_BYTES) {
        if (this.currentSize() > MAX_LOG_BYTES) renameSync(this.path, `${this.path}.1`);
        this.size = this.currentSize();
      }
      appendFileSync(this.path, line);
      this.size += Buffer.byteLength(line);
    } catch {}
  }

  private currentSize(): number {
    try {
      return statSync(this.path).size;
    } catch {
      return 0;
    }
  }
}
