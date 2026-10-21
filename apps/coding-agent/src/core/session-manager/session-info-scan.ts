import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import platform from "../platform.ts";
import type nodeFsTypes from "../platform/node/fs.types.ts";
import type sessionManagerTypes from "../session-manager.types.ts";

const { toDate, toEpochMs } = platform;

function isMessageWithContent(message: agentTypes.AgentMessage): message is aiTypes.Message {
  return typeof (message as aiTypes.Message).role === "string" && "content" in message;
}

function extractTextContent(message: aiTypes.Message): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block): block is aiTypes.TextContent => block.type === "text")
    .map((block) => block.text)
    .join(" ");
}

function getMessageActivityTime(
  entry: sessionManagerTypes.SessionMessageEntry,
): number | undefined {
  const message = entry.message;
  if (!isMessageWithContent(message)) return undefined;
  if (message.role !== "user" && message.role !== "assistant") return undefined;

  const msgTimestamp = (message as { timestamp?: number }).timestamp;
  if (typeof msgTimestamp === "number") {
    return msgTimestamp;
  }

  const t = toEpochMs(entry.timestamp);
  return Number.isNaN(t) ? undefined : t;
}

export default class SessionInfoScan {
  private header: sessionManagerTypes.SessionHeader | null = null;

  private messageCount = 0;

  private firstMessage = "";

  private readonly allMessages: string[] = [];

  private name: string | undefined;

  private lastActivityTime: number | undefined;

  add(entry: sessionManagerTypes.FileEntry): boolean {
    if (this.header === null) {
      if (entry.type !== "session") return false;
      this.header = entry;
      return true;
    }
    if (entry.type === "session_info") {
      this.name = entry.name?.trim() || undefined;
    }
    if (entry.type === "message") this.addMessage(entry);
    return true;
  }

  toInfo(filePath: string, stats: nodeFsTypes.Stats): sessionManagerTypes.SessionInfo | null {
    const { header, lastActivityTime } = this;
    if (header === null) return null;
    const headerTime = typeof header.timestamp === "string" ? toEpochMs(header.timestamp) : NaN;
    const modified =
      typeof lastActivityTime === "number" && lastActivityTime > 0
        ? toDate(lastActivityTime)
        : Number.isNaN(headerTime)
          ? stats.mtime
          : toDate(headerTime);
    return {
      allMessagesText: this.allMessages.join(" "),
      created: toDate(header.timestamp),
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      firstMessage: this.firstMessage || "(no messages)",
      id: header.id,
      messageCount: this.messageCount,
      modified,
      name: this.name,
      parentSessionPath: header.parentSession,
      path: filePath,
    };
  }

  private addMessage(entry: sessionManagerTypes.SessionMessageEntry): void {
    this.messageCount++;
    const activityTime = getMessageActivityTime(entry);
    if (typeof activityTime === "number") {
      this.lastActivityTime = Math.max(this.lastActivityTime ?? 0, activityTime);
    }
    const { message } = entry;
    if (!isMessageWithContent(message)) return;
    if (message.role !== "user" && message.role !== "assistant") return;
    const textContent = extractTextContent(message);
    if (textContent === "") return;
    this.allMessages.push(textContent);
    if (this.firstMessage === "" && message.role === "user") {
      this.firstMessage = textContent;
    }
  }
}
