import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import memoryProject from "../src/core/memory/memory-project.ts";
import MemoryService from "../src/core/memory/memory-service.ts";
import MemoryStore from "../src/core/memory/memory-store.ts";
import type memoryTypes from "../src/core/memory/memory.types.ts";
import MemoryView from "../src/modes/interactive/components/memory-view.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";

const { resolveProjectName } = memoryProject;
const { initTheme } = themeModule;
const { stripAnsi } = ansi;

const { awaited, joinPath, makeTempDir, removeDirs, runTest } = testing;

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";
const BASE_TIME = 1_700_000_000_000;

const tempDirs: string[] = [];
const services: memoryTypes.MemoryService[] = [];

const settingsFor = (dir: string): memoryTypes.ResolvedMemorySettings => ({
  database: joinPath(dir, "memory.db"),
  embedding: {
    baseUrl: "http://127.0.0.1:1/v1",
    documentPrefix: "",
    enabled: false,
    model: "test",
    queryPrefix: "",
    timeoutMs: 500,
  },
  enabled: true,
  recall: { enabled: true, limit: 5, minScore: 0.35 },
});

beforeAll(() => {
  initTheme(undefined, false);
});

afterEach(() =>
  runTest(
    Effect.andThen(
      Effect.promise(() => Promise.all(services.splice(0).map((service) => service.close()))),
      removeDirs(tempDirs.splice(0)),
    ),
  ),
);

const seedMemories = Effect.fn("seedMemories")(function* (
  dir: string,
  database: string,
  extraContent: string | undefined,
) {
  const project = yield* awaited(resolveProjectName(dir));
  const store = new MemoryStore(database);
  const projectMemory = (content: string, kind: "fact" | "note" | "preference", offset: number) =>
    store.save({ content, kind, now: BASE_TIME + offset, project, scope: "project" });
  projectMemory("prefer pnpm over npm", "preference", 2_000);
  projectMemory("the release goes to the Homebrew tap", "fact", 1_000);
  store.save({
    content: "answer in Japanese",
    kind: "preference",
    now: BASE_TIME + 3_000,
    project: null,
    scope: "global",
  });
  if (extraContent !== undefined) {
    projectMemory(extraContent, "note", 4_000);
  }
  store.close();
});

const setup = Effect.fn("setup")(function* (extraContent?: string) {
  const dir = yield* makeTempDir("msa-memory-view-");
  tempDirs.push(dir);
  const settings = settingsFor(dir);
  yield* seedMemories(dir, settings.database, extraContent);
  const service = new MemoryService({ cwd: dir, settings });
  services.push(service);
  const onClose = vi.fn();
  const confirm = vi.fn((_message: string) => Promise.resolve(true));
  const requestRender = vi.fn();
  const view = new MemoryView({
    confirm,
    maxHeight: () => 40,
    onClose,
    onError: vi.fn(),
    requestRender,
    service,
  });
  yield* awaited(vi.waitFor(() => expect(requestRender).toHaveBeenCalled()));
  const screen = () => view.render(100).map((line) => stripAnsi(line).trimEnd());
  return { confirm, onClose, screen, view };
});

const groupsMemoriesByScopeAndShowsKind = () =>
  runTest(
    Effect.gen(function* () {
      const { screen } = yield* setup();
      const text = screen().join("\n");
      expect(text).toContain("Memory");
      expect(text).toMatch(/Project \(msa-memory-view-\w+\)/u);
      expect(text).toContain("Global");
      expect(text).toContain("the release goes to the Homebrew tap");
      expect(text).toContain("prefer pnpm over npm");
      expect(text).toContain("answer in Japanese");
      expect(text).toContain("3 memories");
      expect(text).toContain("0 embedded");
      expect(text).toContain("enter open");
    }),
  );

const opensAMemoryInDetailAndGoes = () =>
  runTest(
    Effect.gen(function* () {
      const { view, screen } = yield* setup();
      view.handleInput(ENTER);
      const detail = screen().join("\n");
      expect(detail).toContain("kind");
      expect(detail).toContain("timestamps");
      expect(detail).toContain("mem_");
      expect(detail).toContain("none (keyword search only)");
      view.handleInput(ESC);
      expect(screen().join("\n")).toContain("Global");
    }),
  );

const scrollsALongMemoryAndStopsAt = () =>
  runTest(
    Effect.gen(function* () {
      const long = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n");
      const { view, screen } = yield* setup(long);
      view.handleInput(ENTER);
      const rows = () => screen().map((line) => line.trim());
      expect(rows()).toContain("line 1");
      expect(rows()).not.toContain("line 40");
      expect(screen().join("\n")).toContain("↓");

      for (let step = 0; step < 5; step++) view.handleInput("\x1b[6~");
      expect(screen().join("\n")).toContain("embedding");
      expect(screen().join("\n")).toContain("↑");
      expect(screen().join("\n")).not.toContain("↓");

      for (let step = 0; step < 5; step++) view.handleInput("\x1b[5~");
      expect(rows()).toContain("line 1");
      expect(screen().join("\n")).not.toContain("↑");
    }),
  );

const forgetsTheSelectedMemoryAfterAConfirmation = () =>
  runTest(
    Effect.gen(function* () {
      const { view, screen, onClose, confirm } = yield* setup();
      view.handleInput("d");
      yield* awaited(vi.waitFor(() => expect(confirm).toHaveBeenCalled()));
      expect(String(confirm.mock.calls[0]?.[0])).toContain("prefer pnpm over npm");
      yield* awaited(
        vi.waitFor(() => expect(screen().join("\n")).not.toContain("prefer pnpm over npm")),
      );
      view.handleInput(ESC);
      expect(onClose).toHaveBeenCalled();
    }),
  );

const keepsTheMemoryWhenTheConfirmationIs = () =>
  runTest(
    Effect.gen(function* () {
      const { view, screen, confirm } = yield* setup();
      confirm.mockResolvedValueOnce(false);
      view.handleInput("d");
      yield* awaited(vi.waitFor(() => expect(confirm).toHaveBeenCalled()));
      expect(screen().join("\n")).toContain("prefer pnpm over npm");
    }),
  );

const searchesWithAndReturnsToTheFull = () =>
  runTest(
    Effect.gen(function* () {
      const { view, screen } = yield* setup();
      view.handleInput("/");
      expect(screen().join("\n")).toContain("enter search");
      for (const key of "homebrew") view.handleInput(key);
      view.handleInput(ENTER);
      yield* awaited(vi.waitFor(() => expect(screen().join("\n")).toContain("search: homebrew")));
      yield* awaited(
        vi.waitFor(() => expect(screen().join("\n")).not.toContain("answer in Japanese")),
      );
      expect(screen().join("\n")).toContain("the release goes to the Homebrew tap");
      view.handleInput(ESC);
      yield* awaited(vi.waitFor(() => expect(screen().join("\n")).toContain("answer in Japanese")));
    }),
  );

const addsAMemoryWithA = () =>
  runTest(
    Effect.gen(function* () {
      const { view, screen } = yield* setup();
      view.handleInput("a");
      expect(screen().join("\n")).toContain("enter save");
      for (const key of "run verify before pushing") view.handleInput(key);
      view.handleInput(ENTER);
      yield* awaited(
        vi.waitFor(() => expect(screen().join("\n")).toContain("run verify before pushing")),
      );
      expect(screen().join("\n")).toContain("4 memories");
    }),
  );

const movesTheSelectionWithTheArrowKeys = () =>
  runTest(
    Effect.gen(function* () {
      const { view, screen } = yield* setup();
      expect(screen().join("\n")).toContain("prefer pnpm over npm");
      view.handleInput(DOWN);
      view.handleInput(ENTER);
      expect(screen().join("\n")).toContain("the release goes to the Homebrew tap");
      expect(screen().join("\n")).not.toContain("prefer pnpm over npm");
    }),
  );

describe("MemoryView", () => {
  it(
    "groups memories by scope and shows kind, content, and counts",
    groupsMemoriesByScopeAndShowsKind,
  );

  it("opens a memory in detail and goes back", opensAMemoryInDetailAndGoes);

  it("scrolls a long memory and stops at both ends", scrollsALongMemoryAndStopsAt);

  it(
    "forgets the selected memory after a confirmation and closes on escape",
    forgetsTheSelectedMemoryAfterAConfirmation,
  );

  it("keeps the memory when the confirmation is declined", keepsTheMemoryWhenTheConfirmationIs);

  it("searches with / and returns to the full list with escape", searchesWithAndReturnsToTheFull);

  it("adds a memory with a", addsAMemoryWithA);

  it("moves the selection with the arrow keys", movesTheSelectionWithTheArrowKeys);
});
