import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  formatMemoryList,
  formatRecallBlock,
  formatSearchResults,
  resolveProjectName,
} from "../src/core/memory/memory.ts";
import { MemoryStore } from "../src/core/memory/store.ts";
import { createMemoryToolDefinition } from "../src/core/tools/memory.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";
import memorySupport from "./memory-support.ts";

const { awaited, basenameOf, joinPath, resolvePath, runTest } = testing;

const { cleanup, makeWorkspace, openService, settings } = memorySupport;

afterEach(() => runTest(cleanup));

type MemoryTool = ReturnType<typeof wrapToolDefinition>;

const textOf = (result: Awaited<ReturnType<MemoryTool["execute"]>>): string =>
  result.content[0]?.type === "text" ? result.content[0].text : "";

const savedIdOf = (details: unknown): string =>
  typeof details === "object" &&
  details !== null &&
  "id" in details &&
  typeof details.id === "string"
    ? details.id
    : "";

const runToolActions = Effect.fn("runToolActions")(function* (tool: MemoryTool) {
  const saved = yield* awaited(
    tool.execute("call-1", { action: "save", content: "prefer pnpm over npm", kind: "preference" }),
  );
  expect(saved.content[0]).toMatchObject({ type: "text" });
  expect(textOf(saved)).toContain("Saved memory");

  const search = yield* awaited(
    tool.execute("call-2", { action: "search", query: "pnpm preference" }),
  );
  expect(textOf(search)).toContain("pnpm");

  const list = yield* awaited(tool.execute("call-3", { action: "list" }));
  expect(textOf(list)).toContain("prefer pnpm");

  const id = savedIdOf(saved.details);
  const forget = yield* awaited(tool.execute("call-4", { action: "forget", id }));
  expect(textOf(forget)).toContain(`Forgot memory ${id}`);
});

const savesSearchesListsAndForgetsThroughThe = () =>
  runTest(
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* makeWorkspace();
        const service = yield* openService(workspace, settings(workspace));
        const tool = wrapToolDefinition(createMemoryToolDefinition(service));
        yield* runToolActions(tool);
        yield* awaited(
          expect(tool.execute("call-5", { action: "search", query: "x" })).resolves.toBeDefined(),
        );
        yield* awaited(
          expect(tool.execute("call-6", { action: "save" })).rejects.toThrow("content"),
        );
      }),
    ),
  );

describe("memory tool", () => {
  it(
    "saves, searches, lists, and forgets through the tool",
    savesSearchesListsAndForgetsThroughThe,
  );
});

const rendersRecallListAndSearchBlocks = () => {
  const store = new MemoryStore(":memory:");
  try {
    const record = store.save({
      content: "msa の記憶は SQLite に保存する",
      kind: "fact",
      project: "msa",
      scope: "project",
    }).record;
    const block = formatRecallBlock([record]);
    expect(block).toContain("<memory>");
    expect(block).toContain("msa の記憶は SQLite に保存する");
    expect(formatMemoryList([record])).toContain(record.id);
    const hits = store.search({ limit: 5, minScore: 0, project: "msa", text: "記憶" });
    expect(formatSearchResults(hits)).toContain(record.id);
    expect(formatMemoryList([])).toBe("No memories stored yet.");
  } finally {
    store.close();
  }
};

describe("formats", () => {
  it("renders recall, list, and search blocks", rendersRecallListAndSearchBlocks);
});

const usesTheGitRepositoryNameWhenAvailable = () =>
  runTest(
    Effect.gen(function* () {
      const repo = resolvePath(import.meta.dirname, "../../..");
      expect(yield* awaited(resolveProjectName(joinPath(repo, "apps")))).toBe(basenameOf(repo));
      const dir = yield* makeWorkspace();
      expect(yield* awaited(resolveProjectName(dir))).toBe(basenameOf(dir));
    }),
  );

describe("resolveProjectName", () => {
  it("uses the git repository name when available", usesTheGitRepositoryNameWhenAvailable);
});
