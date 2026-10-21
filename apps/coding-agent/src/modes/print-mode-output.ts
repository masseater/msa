import type aiTypes from "@msa/ai/index.types";

import type agentSessionTypes from "../core/agent-session.types.ts";
import goalModule from "../core/goal.ts";
import outputGuard from "../core/output-guard.ts";
import platformModule from "../core/platform.ts";
import jsonEvent from "./json-event.ts";
import type printModeTypes from "./print-mode.types.ts";

const { nowMs, writeError } = platformModule;
const { writeRawStdout } = outputGuard;

type Mode = printModeTypes.PrintModeOptions["mode"];

function writeSessionEvent(mode: Mode, event: agentSessionTypes.AgentSessionEvent): void {
  if (mode === "json") {
    writeRawStdout(`${JSON.stringify(jsonEvent.toJsonEvent(event))}\n`);
    return;
  }
  if (event.type === "goal_status") {
    writeError(goalModule.describeGoalStatus(event.goal, nowMs()).join("\n"));
  } else if (event.type === "memory_status") {
    writeError(event.text);
  } else if (event.type === "entry_appended") {
    const line = goalModule.describeGoalEntry(event.entry);
    if (line !== undefined) writeError(line.text);
  }
}

function writeSessionHeader(session: agentSessionTypes.AgentSession): void {
  const header = session.sessionManager.getHeader();
  if (header !== null) writeRawStdout(`${JSON.stringify(header)}\n`);
}

function writeAssistantText(assistantMsg: aiTypes.AssistantMessage): boolean {
  if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
    writeError(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
    return false;
  }
  for (const content of assistantMsg.content) {
    if (content.type === "text") writeRawStdout(`${content.text}\n`);
  }
  if (assistantMsg.stopReason !== "length") return true;
  writeError("Response was truncated: the model reached its output token limit.");
  return false;
}

function writeFinalAnswer(session: agentSessionTypes.AgentSession): boolean {
  const lastMessage = session.state.messages.at(-1);
  return (
    lastMessage?.role !== "assistant" || writeAssistantText(lastMessage as aiTypes.AssistantMessage)
  );
}

const printModeOutput = {
  writeFinalAnswer,
  writeSessionEvent,
  writeSessionHeader,
};

export default printModeOutput;
