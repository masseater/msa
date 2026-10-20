import { type AssistantMessage, type Message, fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import compaction from "../src/harness/compaction.ts";
import contextModule from "../src/harness/context.ts";
import harnessCompactionSupport from "./harness-compaction-support.ts";
import platformSupport from "./platform-support.ts";

const { orderToolResults } = contextModule;
const { selectCut, serializeConversation } = compaction;

const { directories, text, user } = harnessCompactionSupport;
const { removeDir } = platformSupport;

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

let nextId = 1;

function entry(kind: string, model: Message[], head?: number): durableTypes.EntryRecord {
  return {
    conversationId: 1,
    id: nextId++,
    kind,
    model,
    ...(head === undefined ? {} : { head }),
  } as unknown as durableTypes.EntryRecord;
}

const assistant = (
  content: string,
  calls: string[] = [],
  stopReason: AssistantMessage["stopReason"] = "stop",
) =>
  ({
    ...fauxAssistantMessage([
      { text: content, type: "text" },
      ...calls.map((id) => fauxToolCall("read", {}, { id })),
    ]),
    stopReason,
  }) as AssistantMessage;

const toolResult = (callId: string, content: string): Message => ({
  content: [{ text: content, type: "text" }],
  isError: false,
  role: "toolResult",
  timestamp: 0,
  toolCallId: callId,
  toolName: "read",
});

function view(
  entries: durableTypes.EntryRecord[],
  head?: durableTypes.EntryRecord,
): durableTypes.ContextView {
  const all = head === undefined ? entries : [head, ...entries];
  const contributions = all.map((record) =>
    (record.model ?? []).filter(
      (message) =>
        message.role !== "assistant" ||
        !["error", "aborted", "deferred"].includes(message.stopReason),
    ),
  );
  return { contributions, entries: all, head, messages: orderToolResults(contributions.flat()) };
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
        { content: "", role: "system", sections: { s: text("s", 100) }, timestamp: 0 },
      ]),
      entry("msa.assistant", [assistant(text("err", 100), [], "error")]),
      entry("msa.assistant", [assistant(text("stopped", 100), [], "aborted")]),
      entry("msa.assistant", [assistant(text("a2", 100))]),
    ];
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
    expect(selectCut(view(entries), 250)).toBe(4);
  });

  it("finds nothing when the budget is never reached or only the marker precedes the cut", () => {
    const small = [entry("msa.user", [user("hi")]), entry("msa.assistant", [assistant("hello")])];
    expect(selectCut(view(small), 150)).toBeUndefined();
    const marker = entry("msa.compaction", [user("summary")], 0);
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
      { content: "", role: "system", sections: { s: "hidden" }, timestamp: 0 },
      user("hello"),
      {
        ...fauxAssistantMessage([
          { thinking: "hmm", type: "thinking" },
          { text: "sure", type: "text" },
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
