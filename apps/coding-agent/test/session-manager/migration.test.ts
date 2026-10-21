import { describe, expect, it } from "vite-plus/test";

import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import sessionFormat from "../../src/core/session-manager/session-format.ts";

const { migrateSessionEntries } = sessionFormat;

const shouldAddIdParentidToV1 = () => {
  const entries: sessionManagerTypes.FileEntry[] = [
    { cwd: "/tmp", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", type: "session" },
    {
      message: { content: "hi", role: "user", timestamp: 1 },
      timestamp: "2025-01-01T00:00:01Z",
      type: "message",
    },
    {
      message: {
        api: "test",
        content: [{ text: "hello", type: "text" }],
        model: "test",
        provider: "test",
        role: "assistant",
        stopReason: "stop",
        timestamp: 2,
        usage: { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 },
      },
      timestamp: "2025-01-01T00:00:02Z",
      type: "message",
    },
  ] as sessionManagerTypes.FileEntry[];

  migrateSessionEntries(entries);

  expect((entries[0] as any).version).toBe(3);

  const msg1 = entries[1] as any;
  const msg2 = entries[2] as any;

  expect(msg1.id).toBeDefined();
  expect(msg1.id.length).toBe(8);
  expect(msg1.parentId).toBeNull();

  expect(msg2.id).toBeDefined();
  expect(msg2.id.length).toBe(8);
  expect(msg2.parentId).toBe(msg1.id);
};

const shouldBeIdempotentSkipAlreadyMigrated = () => {
  const entries: sessionManagerTypes.FileEntry[] = [
    { cwd: "/tmp", id: "sess-1", timestamp: "2025-01-01T00:00:00Z", type: "session", version: 2 },
    {
      id: "abc12345",
      message: { content: "hi", role: "user", timestamp: 1 },
      parentId: null,
      timestamp: "2025-01-01T00:00:01Z",
      type: "message",
    },
    {
      id: "def67890",
      message: {
        api: "test",
        content: [{ text: "hello", type: "text" }],
        model: "test",
        provider: "test",
        role: "assistant",
        stopReason: "stop",
        timestamp: 2,
        usage: { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 },
      },
      parentId: "abc12345",
      timestamp: "2025-01-01T00:00:02Z",
      type: "message",
    },
  ] as sessionManagerTypes.FileEntry[];

  migrateSessionEntries(entries);

  expect((entries[1] as any).id).toBe("abc12345");
  expect((entries[2] as any).id).toBe("def67890");
  expect((entries[2] as any).parentId).toBe("abc12345");
};

describe("migrateSessionEntries", () => {
  it("should add id/parentId to v1 entries", shouldAddIdParentidToV1);
  it("should be idempotent (skip already migrated)", shouldBeIdempotentSkipAlreadyMigrated);
});
