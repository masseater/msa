import { constants as bufferConstants } from "buffer";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  findMostRecentSession,
  loadEntriesFromFile,
  SessionManager,
} from "../../src/core/session-manager.ts";
import { stringifyJson } from "../test-json.ts";
import { parseJson } from "../test-json.ts";
import { join } from "../test-path.ts";
import { nowMillis } from "../test-time.ts";
import { assistantMsg, readSessionFileRoles, userMsg } from "../utilities.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const HEADER_SCAN_LIMIT_BYTES = 1024 * 1024;

let tempDir: string;

function writeSessionHeader(file: string, cwd: string, id: string, prefix = "") {
  return runtime.runPromise(
    fs.writeFileString(
      file,
      `${prefix}${JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2025-01-01T00:00:00Z",
        cwd,
      })}\n`,
    ),
  );
}

const loadsValidSessionFile = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const file = join(tempDir, "valid.jsonl");
      yield* fs.writeFileString(
        file,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
          '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
      );
      const entries = loadEntriesFromFile(file);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.type).toBe("session");
      expect(entries[1]?.type).toBe("message");
    }),
  );

const skipsMalformedLinesButKeepsValid = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const file = join(tempDir, "mixed.jsonl");
      yield* fs.writeFileString(
        file,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
          "not valid json\n" +
          '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
      );
      const entries = loadEntriesFromFile(file);
      expect(entries).toHaveLength(2);
    }),
  );

const addsANewlineAfterAnUnterminated = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const file = join(tempDir, "unterminated.jsonl");
      const content =
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
        '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}';
      yield* fs.writeFileString(file, content);

      expect(loadEntriesFromFile(file)).toHaveLength(2);
      expect(yield* fs.readFileString(file)).toBe(`${content}\n`);
    }),
  );

const addsANewlineAfterAnUnterminated2 = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const file = join(tempDir, "malformed-tail.jsonl");
      const content =
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
        '{"type":"message"';
      yield* fs.writeFileString(file, content);

      expect(loadEntriesFromFile(file)).toHaveLength(1);
      expect(yield* fs.readFileString(file)).toBe(`${content}\n`);
    }),
  );

const doesNotModifyAnUnterminatedNon = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const file = join(tempDir, "invalid.jsonl");
      const content = '{"type":"message","id":"1"}';
      yield* fs.writeFileString(file, content);

      expect(loadEntriesFromFile(file)).toEqual([]);
      expect(yield* fs.readFileString(file)).toBe(content);
    }),
  );

const opensCompatibleSessionsBeyondTheDiscovery = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const storedCwd = join(tempDir, "stored-project");
      const overrideCwd = join(tempDir, "override-project");
      const cases = [
        { name: "large-header", id: "a".repeat(HEADER_SCAN_LIMIT_BYTES + 1), prefix: "" },
        {
          name: "large-prefix",
          id: "large-prefix",
          prefix: `${"x".repeat(HEADER_SCAN_LIMIT_BYTES + 1)}\n`,
        },
      ];

      for (const { name, id, prefix } of cases) {
        const file = join(tempDir, `${name}.jsonl`);
        yield* Effect.promise(() => writeSessionHeader(file, storedCwd, id, prefix));
        for (const cwdOverride of [undefined, overrideCwd]) {
          const sessionManager = SessionManager.open(file, tempDir, cwdOverride);
          expect(sessionManager.getSessionId()).toBe(id);
          expect(sessionManager.getCwd()).toBe(cwdOverride ?? storedCwd);
        }
      }
    }),
  );

const opensSessionFilesLargerThanNode = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const file = join(tempDir, "large.jsonl");
      yield* fs.writeFileString(
        file,
        '{"type":"session","version":3,"id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );

      const newline = Buffer.from("\n");
      const stride = 16 * 1024 * 1024;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* fs.open(file, { flag: "r+" });
          for (
            let offset = stride;
            offset <= bufferConstants.MAX_STRING_LENGTH + stride;
            offset += stride
          ) {
            yield* handle.seek(BigInt(offset), "start");
            yield* handle.write(newline);
          }
        }),
      );

      yield* fs.writeFileString(
        file,
        '{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
        { flag: "a" },
      );

      const sessionManager = SessionManager.open(file, tempDir);
      expect(sessionManager.getSessionId()).toBe("abc");
      expect(sessionManager.getEntries()).toHaveLength(1);
      expect(sessionManager.buildSessionContext().messages).toEqual([
        { role: "user", content: "hi", timestamp: 1 },
      ]);
    }),
  );

describe("loadEntriesFromFile", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir = yield* fs.makeTempDirectory({ prefix: `session-test-` });
        yield* fs.makeDirectory(tempDir, { recursive: true });
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempDir, { recursive: true, force: true })));
  it("returns empty array for non-existent file", () => {
    const entries = loadEntriesFromFile(join(tempDir, "nonexistent.jsonl"));
    expect(entries).toEqual([]);
  });
  it("returns empty array for empty file", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const file = join(tempDir, "empty.jsonl");
        yield* fs.writeFileString(file, "");
        expect(loadEntriesFromFile(file)).toEqual([]);
      }),
    ));
  it("returns empty array for file without valid session header", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const file = join(tempDir, "no-header.jsonl");
        yield* fs.writeFileString(file, '{"type":"message","id":"1"}\n');
        expect(loadEntriesFromFile(file)).toEqual([]);
      }),
    ));
  it("returns empty array for malformed JSON", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const file = join(tempDir, "malformed.jsonl");
        yield* fs.writeFileString(file, "not json\n");
        expect(loadEntriesFromFile(file)).toEqual([]);
      }),
    ));
  it("loads valid session file", loadsValidSessionFile);
  it("skips malformed lines but keeps valid ones", skipsMalformedLinesButKeepsValid);
  it("adds a newline after an unterminated valid record", addsANewlineAfterAnUnterminated);
  it(
    "adds a newline after an unterminated malformed final fragment",
    addsANewlineAfterAnUnterminated2,
  );
  it("does not modify an unterminated non-session file", doesNotModifyAnUnterminatedNon);
  it.each([
    ["leading blank lines", "\n  \n", "leading-blank"],
    ["leading malformed lines", "not json\n{broken json\n", "leading-malformed"],
    ["a multi-buffer header", "", "a".repeat(8192)],
  ])("reads cwd from a session with %s", (_description, prefix, sessionId) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const file = join(tempDir, "header.jsonl");
        const storedCwd = join(tempDir, "stored-project");
        yield* Effect.promise(() => writeSessionHeader(file, storedCwd, sessionId, prefix));

        const sessionManager = SessionManager.open(file, tempDir);
        expect(sessionManager.getSessionId()).toBe(sessionId);
        expect(sessionManager.getCwd()).toBe(storedCwd);
      }),
    ),
  );
  it(
    "opens compatible sessions beyond the discovery scan limit",
    opensCompatibleSessionsBeyondTheDiscovery,
  );
  it("opens session files larger than Node's max string length", opensSessionFilesLargerThanNode);
});

let tempDir3: string;

const returnsSingleValidSessionFile = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const file = join(tempDir3, "session.jsonl");
      yield* fs.writeFileString(
        file,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );
      expect(findMostRecentSession(tempDir3)).toBe(file);
    }),
  );

const returnsMostRecentlyModifiedSession = Effect.gen(function* () {
  const file1 = join(tempDir3, "older.jsonl");
  const file2 = join(tempDir3, "newer.jsonl");

  yield* fs.writeFileString(
    file1,
    '{"type":"session","id":"old","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  yield* Effect.sleep(10);
  yield* fs.writeFileString(
    file2,
    '{"type":"session","id":"new","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  expect(findMostRecentSession(tempDir3)).toBe(file2);
});

const skipsInvalidFilesAndReturnsValid = Effect.gen(function* () {
  const invalid = join(tempDir3, "invalid.jsonl");
  const valid = join(tempDir3, "valid.jsonl");

  yield* fs.writeFileString(invalid, '{"type":"not-session"}\n');
  yield* Effect.sleep(10);
  yield* fs.writeFileString(
    valid,
    '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
  );

  expect(findMostRecentSession(tempDir3)).toBe(valid);
});

const skipsOversizedCorruptFilesAndReturns = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const invalid = join(tempDir3, "oversized.jsonl");
      const valid = join(tempDir3, "valid.jsonl");
      yield* fs.writeFileString(invalid, "x".repeat(HEADER_SCAN_LIMIT_BYTES + 1));
      yield* fs.writeFileString(
        valid,
        '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n',
      );

      expect(findMostRecentSession(tempDir3)).toBe(valid);
    }),
  );

const filtersMostRecentSessionByCwd = Effect.gen(function* () {
  const projectA = join(tempDir3, "project-a");
  const projectB = join(tempDir3, "project-b");
  const fileA = join(tempDir3, "a.jsonl");
  const fileB = join(tempDir3, "b.jsonl");

  yield* fs.writeFileString(
    fileA,
    `${stringifyJson({ type: "session", id: "a", timestamp: "2025-01-01T00:00:00Z", cwd: projectA })}\n`,
  );
  yield* Effect.sleep(10);
  yield* fs.writeFileString(
    fileB,
    `${stringifyJson({ type: "session", id: "b", timestamp: "2025-01-01T00:00:00Z", cwd: projectB })}\n`,
  );

  expect(findMostRecentSession(tempDir3, projectA)).toBe(fileA);
  expect(findMostRecentSession(tempDir3, projectB)).toBe(fileB);
});

describe("findMostRecentSession", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir3 = yield* fs.makeTempDirectory({ prefix: `session-test-` });
        yield* fs.makeDirectory(tempDir3, { recursive: true });
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempDir3, { recursive: true, force: true })));
  it("returns null for empty directory", () => {
    expect(findMostRecentSession(tempDir3)).toBeNull();
  });
  it("returns null for non-existent directory", () => {
    expect(findMostRecentSession(join(tempDir3, "nonexistent"))).toBeNull();
  });
  it("ignores non-jsonl files", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        yield* fs.writeFileString(join(tempDir3, "file.txt"), "hello");
        yield* fs.writeFileString(join(tempDir3, "file.json"), "{}");
        expect(findMostRecentSession(tempDir3)).toBeNull();
      }),
    ));
  it("ignores jsonl files without valid session header", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        yield* fs.writeFileString(join(tempDir3, "invalid.jsonl"), '{"type":"message"}\n');
        expect(findMostRecentSession(tempDir3)).toBeNull();
      }),
    ));
  it("returns single valid session file", returnsSingleValidSessionFile);
  it("returns most recently modified session", () =>
    Effect.runPromise(returnsMostRecentlyModifiedSession));
  it("skips invalid files and returns valid one", () =>
    Effect.runPromise(skipsInvalidFilesAndReturnsValid));
  it(
    "skips oversized corrupt files and returns a valid session",
    skipsOversizedCorruptFilesAndReturns,
  );
  it("filters most recent session by cwd", () => Effect.runPromise(filtersMostRecentSessionByCwd));
});

let tempDir4: string;

let projectA: string;

let projectB: string;

function createPersistedSession(cwd: string, label: string): string {
  const session = SessionManager.create(cwd, tempDir4);
  session.appendMessage({ role: "user", content: label, timestamp: nowMillis() });
  session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: `reply to ${label}` }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: nowMillis(),
  });
  const sessionFile = session.getSessionFile();
  if (sessionFile === undefined || sessionFile === "") {
    throw new Error("Expected persisted session file");
  }
  return sessionFile;
}

const scopesCurrentFolderApisByCwd = Effect.gen(function* () {
  const sessionA = createPersistedSession(projectA, "from A");
  yield* Effect.sleep(10);
  const sessionB = createPersistedSession(projectB, "from B");

  const currentA = yield* Effect.promise(() => SessionManager.list(projectA, tempDir4));
  expect(currentA.map((session) => session.path)).toEqual([sessionA]);

  const all = yield* Effect.promise(() => SessionManager.listAll(tempDir4));
  expect(new Set(all.map((session) => session.path))).toEqual(new Set([sessionA, sessionB]));

  const continuedA = SessionManager.continueRecent(projectA, tempDir4);
  expect(continuedA.getSessionFile()).toBe(sessionA);
});

const rejectsACancelledSessionListing = Effect.gen(function* () {
  createPersistedSession(projectA, "from A");
  createPersistedSession(projectB, "from B");
  const controller = new AbortController();
  const listing = SessionManager.listAll(
    tempDir4,
    (_loaded, _total, partialSessions) => {
      if (partialSessions !== undefined) controller.abort();
    },
    controller.signal,
  );

  yield* Effect.promise(() => expect(listing).rejects.toMatchObject({ name: "AbortError" }));
  yield* Effect.promise(() =>
    expect(SessionManager.listAll(undefined, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    }),
  );
});

describe("SessionManager custom flat session directory", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir4 = yield* fs.makeTempDirectory({ prefix: `session-test-` });
        projectA = join(tempDir4, "project-a");
        projectB = join(tempDir4, "project-b");
        yield* fs.makeDirectory(projectA, { recursive: true });
        yield* fs.makeDirectory(projectB, { recursive: true });
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempDir4, { recursive: true, force: true })));
  it("scopes current-folder APIs by cwd while listing all flat sessions", () =>
    Effect.runPromise(scopesCurrentFolderApisByCwd));
  it("rejects a cancelled session listing", () =>
    Effect.runPromise(rejectsACancelledSessionListing));
});

let tempDir5: string;

const truncatesAndRewritesEmptyFileWith = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const emptyFile = join(tempDir5, "empty.jsonl");
      yield* fs.writeFileString(emptyFile, "");

      const sm = SessionManager.open(emptyFile, tempDir5);

      expect(sm.getSessionId()).toBeTruthy();
      expect(sm.getHeader()).toBeTruthy();
      expect(sm.getHeader()?.type).toBe("session");

      const content = yield* fs.readFileString(emptyFile);
      const lines = content.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      const [headerLine] = lines;
      if (headerLine === undefined) throw new Error("expected a header line");
      const header = parseJson(headerLine) as { type: string; id: string };
      expect(header.type).toBe("session");
      expect(header.id).toBe(sm.getSessionId());
    }),
  );

const throwsAndPreservesNonEmptyFile = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const noHeaderFile = join(tempDir5, "no-header.jsonl");
      const originalContent =
        '{"type":"message","id":"abc","parentId":"orphaned","timestamp":"2025-01-01T00:00:00Z","message":{"role":"assistant","content":"test"}}\n';
      yield* fs.writeFileString(noHeaderFile, originalContent);

      expect(() => SessionManager.open(noHeaderFile, tempDir5)).toThrow(
        `Session file is not a valid msa session: ${noHeaderFile}`,
      );
      expect(yield* fs.readFileString(noHeaderFile)).toBe(originalContent);
    }),
  );

const throwsAndPreservesNonSessionJsonl = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const nonSessionFile = join(tempDir5, "not-a-session.log");
      const originalContent = '{"type":"event","data":"not a session"}\n';
      yield* fs.writeFileString(nonSessionFile, originalContent);

      expect(() => SessionManager.open(nonSessionFile, tempDir5)).toThrow(
        `Session file is not a valid msa session: ${nonSessionFile}`,
      );
      expect(yield* fs.readFileString(nonSessionFile)).toBe(originalContent);
    }),
  );

const preservesExplicitSessionFilePathWhen = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const explicitPath = join(tempDir5, "my-session.jsonl");
      yield* fs.writeFileString(explicitPath, "");

      const sm = SessionManager.open(explicitPath, tempDir5);

      expect(sm.getSessionFile()).toBe(explicitPath);
    }),
  );

const subsequentLoadsOfInitializedEmptyFile = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const emptyFile = join(tempDir5, "empty.jsonl");
      yield* fs.writeFileString(emptyFile, "");

      const sm1 = SessionManager.open(emptyFile, tempDir5);
      const sessionId = sm1.getSessionId();

      const sm2 = SessionManager.open(emptyFile, tempDir5);
      expect(sm2.getSessionId()).toBe(sessionId);
      expect(sm2.getHeader()?.type).toBe("session");
    }),
  );

describe("SessionManager.setSessionFile with corrupted files", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        tempDir5 = yield* fs.makeTempDirectory({ prefix: `session-test-` });
        yield* fs.makeDirectory(tempDir5, { recursive: true });
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempDir5, { recursive: true, force: true })));
  it("truncates and rewrites empty file with valid header", truncatesAndRewritesEmptyFileWith);
  it("throws and preserves non-empty file without valid header", throwsAndPreservesNonEmptyFile);
  it("throws and preserves non-session JSONL files", throwsAndPreservesNonSessionJsonl);
  it(
    "preserves explicit session file path when recovering from corrupted file",
    preservesExplicitSessionFilePathWhen,
  );
  it(
    "subsequent loads of initialized empty file work correctly",
    subsequentLoadsOfInitializedEmptyFile,
  );
});

let tempDir6: string;

const doesNotCreateAFileFor = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const session = SessionManager.create(tempDir6, tempDir6);
      session.appendModelChange("anthropic", "claude-sonnet-4-5");
      session.appendThinkingLevelChange("off");

      expect(yield* fs.exists(session.getSessionFile()!)).toBe(false);
    }),
  );

const createsTheFileWhenTheFirst = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const session = SessionManager.create(tempDir6, tempDir6);
      session.appendModelChange("anthropic", "claude-sonnet-4-5");
      session.appendMessage(userMsg("first question"));

      const file = session.getSessionFile()!;
      expect(yield* Effect.promise(() => readSessionFileRoles(file))).toEqual([
        "session",
        "model_change",
        "user",
      ]);
      expect(SessionManager.open(file, tempDir6).buildSessionContext().messages).toHaveLength(1);
    }),
  );

const appendsLaterEntriesToTheFile = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const session = SessionManager.create(tempDir6, tempDir6);
      session.appendMessage(userMsg("first question"));
      session.appendCustomEntry("preset-state", { name: "plan" });
      session.appendMessage(assistantMsg("first answer"));

      expect(yield* Effect.promise(() => readSessionFileRoles(session.getSessionFile()!))).toEqual([
        "session",
        "user",
        "custom",
        "assistant",
      ]);
    }),
  );

describe("SessionManager session file creation", () => {
  beforeEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        const value = (tempDir6 = yield* fs.makeTempDirectory({ prefix: "msa-session-persist-" }));
        return value;
      }),
    ),
  );
  afterEach(() => runtime.runPromise(fs.remove(tempDir6, { recursive: true, force: true })));
  it("does not create a file for a session with only setup entries", doesNotCreateAFileFor);
  it("creates the file when the first user message is appended", createsTheFileWhenTheFirst);
  it(
    "appends later entries to the file without rewriting earlier ones",
    appendsLaterEntriesToTheFile,
  );
});
