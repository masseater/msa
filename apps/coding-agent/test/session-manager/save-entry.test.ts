import { describe, expect, it } from "vite-plus/test";

import SessionManager from "../../src/core/session-manager.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
const savesCustomEntriesAndIncludesThem = () => {
  const session = SessionManager.inMemory();

  const msgId = session.appendMessage({ content: "hello", role: "user", timestamp: 1 });

  const customId = session.appendCustomEntry("my_data", { foo: "bar" });

  const msg2Id = session.appendMessage({
    api: "anthropic-messages",
    content: [{ text: "hi", type: "text" }],
    model: "test",
    provider: "anthropic-api",
    role: "assistant",
    stopReason: "stop",
    timestamp: 2,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 1,
      output: 1,
      totalTokens: 2,
    },
  });

  const entries = session.getEntries();
  expect(entries).toHaveLength(3);

  const customEntry = entries.find((e) => e.type === "custom") as sessionManagerTypes.CustomEntry;
  expect(customEntry).toBeDefined();
  expect(customEntry.customType).toBe("my_data");
  expect(customEntry.data).toEqual({ foo: "bar" });
  expect(customEntry.id).toBe(customId);
  expect(customEntry.parentId).toBe(msgId);

  const path = session.getBranch();
  expect(path).toHaveLength(3);
  expect(path[0]?.id).toBe(msgId);
  expect(path[1]?.id).toBe(customId);
  expect(path[2]?.id).toBe(msg2Id);

  const ctx = session.buildSessionContext();
  expect(ctx.messages).toHaveLength(2);
};

describe("SessionManager.saveCustomEntry", () => {
  it("saves custom entries and includes them in tree traversal", savesCustomEntriesAndIncludesThem);
});
