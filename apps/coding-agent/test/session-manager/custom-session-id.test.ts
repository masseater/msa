import * as NodeServices from "@effect/platform-node/NodeServices";
import { basenameOf, currentTimeMillis, joinPath, nowIso, toJsonText } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { SessionManager } from "../../src/core/session-manager.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const rejectsInvalidCustomSessionIds = () => {
  const invalidIds = [
    "",
    "-abc",
    "abc-",
    "_abc",
    "abc_",
    ".abc",
    "abc.",
    "abc/def",
    "abc\\def",
    "abc def",
  ];

  for (const id of invalidIds) {
    const session = SessionManager.inMemory();
    expect(() => session.newSession({ id })).toThrow(
      "Session id must be non-empty, contain only alphanumeric characters",
    );
  }
};

const generatesAUuidv7IdWhenNo = () => {
  const session = SessionManager.inMemory();
  session.newSession();
  const id = session.getSessionId();
  expect(id).toBeDefined();
  expect(id).not.toBe("");
  expect(id).toMatch(UUID_V7_RE);
};

const generatesAUuidv7IdWhenOptions = () => {
  const session = SessionManager.inMemory();
  session.newSession({ parentSession: "parent.jsonl" });
  const id = session.getSessionId();
  expect(id).toBeDefined();
  expect(id).not.toBe("");
  expect(id).toMatch(UUID_V7_RE);
};

const includesTheCustomIdInThe = () => {
  const session = SessionManager.inMemory();
  session.newSession({ id: "header-test-id" });

  const header = session.getHeader();
  expect(header).not.toBeNull();
  expect(header!.id).toBe("header-test-id");
};

const usesTheProvidedIdWhenCreating = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: "msa-session-manager-" });
      const session = SessionManager.create(tempDir, tempDir, { id: "created-session-id" });

      expect(session.getSessionId()).toBe("created-session-id");
      expect(session.getHeader()!.id).toBe("created-session-id");
      const sessionFile = session.getSessionFile()!;
      expect(sessionFile).toContain("created-session-id");
      expect(basenameOf(sessionFile)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_created-session-id\.jsonl$/u,
      );
      expect(yield* fs.exists(sessionFile)).toBe(false);
    }),
  );

const generatesAUuidv7IdWhenCreating = () => {
  const session = SessionManager.inMemory();
  const firstId = session.appendMessage({
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: currentTimeMillis(),
  });

  session.createBranchedSession(firstId);

  expect(session.getSessionId()).toMatch(UUID_V7_RE);
  expect(session.getHeader()!.id).toBe(session.getSessionId());
};

const generatesAUuidv7IdWhenForking = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: "msa-session-manager-" });
      const sourcePath = joinPath(tempDir, "source.jsonl");
      yield* fs.writeFileString(
        sourcePath,
        `${[
          yield* toJsonText({
            type: "session",
            version: 3,
            id: "legacy-session-id",
            timestamp: nowIso(),
            cwd: tempDir,
          }),
          yield* toJsonText({
            type: "message",
            id: "entry-1",
            parentId: null,
            timestamp: nowIso(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hello" }],
              api: "openai-responses",
              provider: "openai",
              model: "gpt-5.4",
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop",
              timestamp: currentTimeMillis(),
            },
          }),
        ].join("\n")}
`,
      );

      const forked = SessionManager.forkFrom(sourcePath, tempDir, tempDir);
      const header = forked.getHeader();
      expect(header).not.toBeNull();
      expect(header!.id).toMatch(UUID_V7_RE);
      expect(header!.parentSession).toBe(sourcePath);
    }),
  );

const usesTheProvidedIdWhenForking = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: "msa-session-manager-" });
      const sourcePath = joinPath(tempDir, "source.jsonl");
      yield* fs.writeFileString(
        sourcePath,
        `${yield* toJsonText({
          type: "session",
          version: 3,
          id: "source-session-id",
          timestamp: nowIso(),
          cwd: tempDir,
        })}\n`,
      );

      const forked = SessionManager.forkFrom(sourcePath, tempDir, tempDir, {
        id: "forked-session-id",
      });
      const header = forked.getHeader();
      expect(header).not.toBeNull();
      expect(header!.id).toBe("forked-session-id");
      expect(header!.parentSession).toBe(sourcePath);
      const sessionFile = forked.getSessionFile()!;
      expect(sessionFile).toContain("forked-session-id");
      expect(basenameOf(sessionFile)).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_forked-session-id\.jsonl$/u,
      );
    }),
  );

describe("SessionManager.newSession with custom id", () => {
  it("uses the provided id instead of generating one", () => {
    const session = SessionManager.inMemory();
    session.newSession({ id: "my-custom-id" });
    expect(session.getSessionId()).toBe("my-custom-id");
  });
  it("uses the provided id when creating an in-memory session", () => {
    const session = SessionManager.inMemory(process.cwd(), { id: "memory-session-id" });
    expect(session.getSessionId()).toBe("memory-session-id");
    expect(session.getHeader()!.id).toBe("memory-session-id");
    expect(session.getSessionFile()).toBeUndefined();
  });
  it("allows alphanumeric session ids with interior punctuation", () => {
    const session = SessionManager.inMemory();
    session.newSession({ id: "abc-123_def.456" });
    expect(session.getSessionId()).toBe("abc-123_def.456");
  });
  it("rejects invalid custom session ids", rejectsInvalidCustomSessionIds);
  it("generates a UUIDv7 id when no id is provided", generatesAUuidv7IdWhenNo);
  it("generates a UUIDv7 id when options is provided without id", generatesAUuidv7IdWhenOptions);
  it("includes the custom id in the session header", includesTheCustomIdInThe);
  it("generates a UUIDv7 id when constructed without an explicit id", () => {
    const session = SessionManager.inMemory();
    expect(session.getSessionId()).toMatch(UUID_V7_RE);
    expect(session.getHeader()!.id).toBe(session.getSessionId());
  });
  it("uses the provided id when creating a persisted session", usesTheProvidedIdWhenCreating);
  it("generates a UUIDv7 id when creating a branched session", generatesAUuidv7IdWhenCreating);
  it("generates a UUIDv7 id when forking from another session file", generatesAUuidv7IdWhenForking);
  it("uses the provided id when forking from another session file", usesTheProvidedIdWhenForking);
});
