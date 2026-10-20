import { createInterface } from "readline";

import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";

import platform from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

const { uuidv7 } = ai;
const { toEpochMs } = platform;
const { createReadStream } = nodeFs;

function createSessionId(): string {
  return uuidv7();
}

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

function buildSessionInfoPart2(
  messageCount: number,
  entry: sessionManagerTypes.SessionMessageEntry,
  lastActivityTime: number | undefined,
) {
  messageCount++;

  const activityTime = getMessageActivityTime(entry);
  if (typeof activityTime === "number") {
    lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
  }

  const message = entry.message;
  return { lastActivityTime, message, messageCount };
}

function buildSessionInfoPart1(filePath: string, signal: AbortSignal | undefined) {
  let header: sessionManagerTypes.SessionHeader | null = null;
  let messageCount = 0;
  let firstMessage = "";
  const allMessages: string[] = [];
  let name: string | undefined = undefined;
  let lastActivityTime: number | undefined = undefined;

  const rl = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: "utf8", signal }),
  });

  const lines = rl[Symbol.asyncIterator]();
  return { allMessages, firstMessage, header, lastActivityTime, lines, messageCount, name };
}

const sessionManagerHelpersPart1 = {
  buildSessionInfoPart1,
  buildSessionInfoPart2,
  createSessionId,
  extractTextContent,
  getMessageActivityTime,
  isMessageWithContent,
};

export default sessionManagerHelpersPart1;
