import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import type {
  FileEntry,
  SessionEntry,
  SessionMessageEntry,
} from "../../src/core/session-manager.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

const { currentTimeMillis } = testing;

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function userMessage(text: string) {
  return {
    content: [{ text, type: "text" as const }],
    role: "user" as const,
    timestamp: currentTimeMillis(),
  };
}

function storedEntries(build: (source: SessionManager) => void): SessionEntry[] {
  const source = SessionManager.inMemory("/project");
  build(source);
  return source.getEntries();
}

const adoptsEntriesVerbatim = () => {
  const entries = storedEntries((source) => {
    source.appendMessage(userMessage("hello"));
    source.appendModelChange("anthropic-api", "claude-opus-4-5");
    source.appendMessage(userMessage("again"));
  });

  const session = SessionManager.inMemory("/project", undefined, entries);

  expect(session.getEntries()).toEqual(entries);
};

const keepsTheLoadedLeafSoAppends = () => {
  const entries = storedEntries((source) => {
    source.appendMessage(userMessage("hello"));
    source.appendMessage(userMessage("again"));
  });
  const lastEntry = entries.at(-1);
  if (lastEntry === undefined) throw new Error("expected stored entries");
  const lastId = lastEntry.id;

  const session = SessionManager.inMemory("/project", undefined, entries);
  const appendedId = session.appendMessage(userMessage("continued"));

  expect(session.getLeafId()).toBe(appendedId);
  expect(session.getEntry(appendedId)?.parentId).toBe(lastId);
};

const neverMintsAnIdThatCollides = () => {
  const entries = storedEntries((source) => {
    for (let i = 0; i < 50; i++) source.appendMessage(userMessage(`message ${i}`));
  });

  const session = SessionManager.inMemory("/project", undefined, entries);
  const appendedId = session.appendMessage(userMessage("continued"));

  expect(entries.some((entry) => entry.id === appendedId)).toBe(false);
};

const rebuildsTheBranchStructureRatherThan = () => {
  const entries = storedEntries((source) => {
    const firstId = source.appendMessage(userMessage("hello"));
    source.appendMessage(userMessage("abandoned"));
    source.branch(firstId);
    source.appendMessage(userMessage("kept"));
  });

  const session = SessionManager.inMemory("/project", undefined, entries);
  const roots = session.getTree();

  expect(roots).toHaveLength(1);
  expect(roots[0]?.children).toHaveLength(2);
};

const rebuildsLabels = () => {
  let labelledId = "";
  const entries = storedEntries((source) => {
    labelledId = source.appendMessage(userMessage("hello"));
    source.appendLabelChange(labelledId, "checkpoint");
  });

  const session = SessionManager.inMemory("/project", undefined, entries);

  expect(session.getLabel(labelledId)).toBe("checkpoint");
};

const resolvesACompactionAgainstTheEntry = () => {
  let keptId = "";
  const entries = storedEntries((source) => {
    source.appendMessage(userMessage("dropped"));
    keptId = source.appendMessage(userMessage("kept"));
    source.appendCompaction("summary so far", keptId, 1000);
  });

  const session = SessionManager.inMemory("/project", undefined, entries);
  const context = session.buildContextEntries();

  expect(context.some((entry) => entry.id === keptId)).toBe(true);
};

const createsAHeaderFromTheOptions = () => {
  const entries = storedEntries((source) => source.appendMessage(userMessage("hello")));

  const session = SessionManager.inMemory("/project", { id: "restored-session" }, entries);

  expect(session.getSessionId()).toBe("restored-session");
  expect(session.getHeader()!.id).toBe("restored-session");
  expect(session.getHeader()!.cwd).toBe("/project");
};

const generatesASessionIdWhenThe = () => {
  const entries = storedEntries((source) => source.appendMessage(userMessage("hello")));

  const session = SessionManager.inMemory("/project", undefined, entries);

  expect(session.getSessionId()).toMatch(UUID_V7_RE);
  expect(session.getHeader()!.id).toBe(session.getSessionId());
};

const staysOffTheFilesystem = () => {
  const entries = storedEntries((source) => source.appendMessage(userMessage("hello")));

  const session = SessionManager.inMemory("/project", undefined, entries);
  session.appendMessage(userMessage("continued"));

  expect(session.getSessionFile()).toBeUndefined();
  expect(session.isPersisted()).toBe(false);
};

const startsAnEmptySessionWhenThe = () => {
  const session = SessionManager.inMemory("/project", { id: "empty-session" }, []);

  expect(session.getSessionId()).toBe("empty-session");
  expect(session.getEntries()).toEqual([]);
  expect(session.getLeafId()).toBeNull();
};

const takesTheSessionIdentityFromA = () => {
  const body = storedEntries((source) => source.appendMessage(userMessage("hello")));
  const entries: FileEntry[] = [
    {
      cwd: "/stored",
      id: "stored-session",
      timestamp: "2026-01-01T00:00:00Z",
      type: "session",
      version: 3,
    },
    ...body,
  ];

  const session = SessionManager.inMemory("/project", { id: "ignored" }, entries);

  expect(session.getSessionId()).toBe("stored-session");
  expect(session.getHeader()!.cwd).toBe("/stored");
};

const migratesEntriesRestoredWithAnOlder = () => {
  const entries: FileEntry[] = [
    {
      cwd: "/project",
      id: "v2-session",
      timestamp: "2026-01-01T00:00:00Z",
      type: "session",
      version: 2,
    },
    {
      id: "abc12345",
      message: { content: "from a hook", role: "hookMessage", timestamp: 1 },
      parentId: null,
      timestamp: "2026-01-01T00:00:01Z",
      type: "message",
    } as unknown as SessionMessageEntry,
  ];

  const session = SessionManager.inMemory("/project", undefined, entries);
  const restored = session.getEntries()[0] as SessionMessageEntry;

  expect(session.getHeader()!.version).toBe(3);
  expect(restored.message.role).toBe("custom");
  expect(restored.id).toBe("abc12345");
};

const adoptsHeaderlessEntriesAsCurrentVersion = () => {
  const entries: SessionEntry[] = [
    {
      id: "abc12345",
      message: { content: "from a hook", role: "hookMessage", timestamp: 1 },
      parentId: null,
      timestamp: "2026-01-01T00:00:01Z",
      type: "message",
    } as unknown as SessionMessageEntry,
  ];

  const session = SessionManager.inMemory("/project", undefined, entries);
  const restored = session.getEntries()[0] as SessionMessageEntry;

  expect(restored.message.role).toBe("hookMessage");
};

describe("SessionManager.inMemory with preloaded entries", () => {
  it("adopts entries verbatim", adoptsEntriesVerbatim);
  it("keeps the loaded leaf so appends continue the conversation", keepsTheLoadedLeafSoAppends);
  it("never mints an id that collides with a loaded entry", neverMintsAnIdThatCollides);
  it(
    "rebuilds the branch structure rather than a flat chain",
    rebuildsTheBranchStructureRatherThan,
  );
  it("rebuilds labels", rebuildsLabels);
  it(
    "resolves a compaction against the entry it was written against",
    resolvesACompactionAgainstTheEntry,
  );
  it("creates a header from the options when the entries carry none", createsAHeaderFromTheOptions);
  it("generates a session id when the options carry none", generatesASessionIdWhenThe);
  it("stays off the filesystem", staysOffTheFilesystem);
  it("starts an empty session when the entries are empty", startsAnEmptySessionWhenThe);
  it("takes the session identity from a header among the entries", takesTheSessionIdentityFromA);
  it("migrates entries restored with an older header", migratesEntriesRestoredWithAnOlder);
  it(
    "adopts headerless entries as current-version without migrating them",
    adoptsHeaderlessEntriesAsCurrentVersion,
  );
});
