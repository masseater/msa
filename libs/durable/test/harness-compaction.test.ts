import { rm } from "node:fs/promises";

import { type AssistantMessage, fauxAssistantMessage, fauxToolCall, type Message } from "@msa/ai";
import { type ContextView, type EntryRecord } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { selectCut, serializeConversation } from "../src/harness/compaction.ts";
import { orderToolResults } from "../src/harness/context.ts";
import { text, directories, user } from "./harness-compaction-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

let nextId = 1;

function entry(kind: string, model: Message[], head?: number): EntryRecord {
  return {
    id: nextId++,
    conversationId: 1,
    kind,
    model,
    ...(head === undefined ? {} : { head }),
  } as unknown as EntryRecord;
}

const assistant = (
  content: string,
  calls: string[] = [],
  stopReason: AssistantMessage["stopReason"] = "stop",
) =>
  ({
    ...fauxAssistantMessage([
      { type: "text", text: content },
      ...calls.map((id) => fauxToolCall("read", {}, { id })),
    ]),
    stopReason,
  }) as AssistantMessage;

const toolResult = (callId: string, content: string): Message => ({
  role: "toolResult",
  toolCallId: callId,
  toolName: "read",
  content: [{ type: "text", text: content }],
  isError: false,
  timestamp: 0,
});

// A view over `entries` whose contributions are their models, with excluded assistants removed.
function view(entries: EntryRecord[], head?: EntryRecord): ContextView {
  const all = head === undefined ? entries : [head, ...entries];
  const contributions = all.map((record) =>
    (record.model ?? []).filter(
      (message) =>
        message.role !== "assistant" ||
        !["error", "aborted", "deferred"].includes(message.stopReason),
    ),
  );
  return { head, entries: all, contributions, messages: orderToolResults(contributions.flat()) };
}

describe("range selection", () => {
  it("keeps about keepRecentTokens and cuts at the first candidate at or after the budget (spec §8.7 example)", () => {
    const entries = [
      entry("msa.user", [user(text("1", 10))]),
      entry("msa.assistant", [assistant("2", ["c1"])]),
      entry("msa.tool-result", [toolResult("c1", text("3", 3000))]),
      entry("msa.assistant", [assistant(text("4", 10))]),
      entry("msa.user", [user(text("5", 10))]),
      entry("msa.assistant", [assistant(text("6", 10))]),
    ];
    expect(selectCut(view(entries), 2000)).toBe(3);
  });

  it("cuts at a user entry", () => {
    const entries = [
      entry("msa.user", [user(text("u1", 100))]),
      entry("msa.assistant", [assistant(text("a1", 100))]),
      entry("msa.user", [user(text("u2", 100))]),
      entry("msa.assistant", [assistant(text("a2", 100))]),
    ];
    expect(selectCut(view(entries), 150)).toBe(2);
  });

  it("cuts at an assistant in the middle of one long run and never at a tool result", () => {
    const entries = [entry("msa.user", [user("do it")])];
    for (let index = 0; index < 5; index++) {
      entries.push(entry("msa.assistant", [assistant(`step ${index}`, [`c${index}`])]));
      entries.push(entry("msa.tool-result", [toolResult(`c${index}`, text(`r${index}`, 100))]));
    }
    const cut = selectCut(view(entries), 150)!;
    // The budget is reached at the fourth result; the cut is the last call, whose result it keeps.
    expect(entries[cut]!.kind).toBe("msa.assistant");
    expect(cut).toBe(9);
  });

  it("never cuts at a display-only entry where the budget is reached (#10407)", () => {
    const entries = [
      entry("msa.user", [user(text("u1", 100))]),
      entry("msa.assistant", [assistant(text("a1", 100))]),
      entry("chat.message", []),
      entry("msa.assistant", [assistant(text("a2", 100))]),
    ];
    // The budget is reached at a1; the display-only entry after it is skipped for the assistant a2.
    expect(selectCut(view(entries), 150)).toBe(1);
    expect(selectCut(view(entries), 50)).toBe(3);
  });
});

describe("range selection", () => {
  it("keeps a huge last tool result together with its assistant", () => {
    const entries = [
      entry("msa.user", [user("u")]),
      entry("msa.assistant", [assistant("a", ["c"])]),
      entry("msa.tool-result", [toolResult("c", text("big", 5000))]),
    ];
    expect(selectCut(view(entries), 100)).toBe(1);
  });

  it("never cuts at a system entry or an excluded error or aborted answer", () => {
    const entries = [
      entry("msa.user", [user(text("u1", 100))]),
      entry("msa.assistant", [assistant(text("a1", 100))]),
      entry("msa.system", [
        { role: "system", content: "", sections: { s: text("s", 100) }, timestamp: 0 },
      ]),
      entry("msa.assistant", [assistant(text("err", 100), [], "error")]),
      entry("msa.assistant", [assistant(text("stopped", 100), [], "aborted")]),
      entry("msa.assistant", [assistant(text("a2", 100))]),
    ];
    // The walk reaches 150 at the system entry; the excluded answers after it contribute nothing.
    expect(selectCut(view(entries), 150)).toBe(5);
  });

  it("follows edited contributions: an omitted entry adds nothing and is no candidate", () => {
    const entries = [
      entry("msa.user", [user(text("u1", 100))]),
      entry("msa.assistant", [assistant(text("a1", 100))]),
      entry("msa.user", [user(text("u2", 100))]),
      entry("msa.assistant", [assistant(text("a2", 100))]),
    ];
    const plain = view(entries);
    expect(selectCut(plain, 150)).toBe(2);
    const contributions = plain.contributions.map((messages, index) =>
      index === 2 ? [] : messages,
    );
    const omitted = { ...plain, contributions, messages: orderToolResults(contributions.flat()) };
    expect(selectCut(omitted, 150)).toBe(1);
  });
});

describe("range selection", () => {
  it("does not cut at a user entry that a result of the preceding call still follows", () => {
    const entries = [
      entry("msa.user", [user(text("u1", 100))]),
      entry("msa.assistant", [assistant("a", ["c"])]),
      entry("msa.user", [user(text("steer", 100))]),
      entry("msa.tool-result", [toolResult("c", text("r", 100))]),
      entry("msa.assistant", [assistant(text("a2", 100))]),
    ];
    // The budget is reached at the steer; its result follows it, so the cut moves to the next assistant.
    expect(selectCut(view(entries), 250)).toBe(4);
  });

  it("finds nothing when the budget is never reached or only the marker precedes the cut", () => {
    const small = [entry("msa.user", [user("hi")]), entry("msa.assistant", [assistant("hello")])];
    expect(selectCut(view(small), 150)).toBeUndefined();
    const marker = entry("msa.compaction", [user("summary")], 0);
    // The budget is reached at the only entry after the marker, so the marker alone would be summarized.
    expect(
      selectCut(view([entry("msa.user", [user(text("u", 200))])], marker), 150),
    ).toBeUndefined();
  });

  it("summarizes an earlier summary marker first", () => {
    const marker = entry("msa.compaction", [user("EARLIER")], 0);
    const kept = [
      entry("msa.user", [user(text("u1", 100))]),
      entry("msa.assistant", [assistant(text("a1", 100))]),
      entry("msa.user", [user(text("u2", 100))]),
      entry("msa.assistant", [assistant(text("a2", 100))]),
    ];
    const selected = view(kept, marker);
    expect(selectCut(selected, 150)).toBe(3);
    expect(serializeConversation(selected.contributions.slice(0, 3).flat())).toMatch(
      /^\[User\]: EARLIER/u,
    );
  });
});

describe("serialization", () => {
  it("writes a transcript, truncates tool results, and omits system messages and thinking", () => {
    const call = fauxToolCall("read", { path: "a.ts" }, { id: "c" });
    const messages: Message[] = [
      { role: "system", content: "", sections: { s: "hidden" }, timestamp: 0 },
      user("hello"),
      {
        ...fauxAssistantMessage([
          { type: "thinking", thinking: "hmm" },
          { type: "text", text: "sure" },
          call,
        ]),
      },
      toolResult("c", "y".repeat(2500)),
    ];
    const serialized = serializeConversation(messages);
    expect(serialized).not.toContain("hidden");
    expect(serialized).toContain("[User]: hello");
    expect(serialized).not.toContain("hmm");
    expect(serialized).not.toContain("[Assistant thinking]");
    expect(serialized).toContain("[Assistant]: sure");
    expect(serialized).toContain('[Assistant tool calls]: read(path="a.ts")');
    expect(serialized).toContain(
      `[Tool result]: ${"y".repeat(2000)}\n\n[... 500 more characters truncated]`,
    );
  });
});
