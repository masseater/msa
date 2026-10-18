import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { awaited, runTest, joinPath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import {
  MemoryService,
  resolveProjectName,
  type ResolvedMemorySettings,
} from "../src/core/memory/memory.ts";
import { MemoryStore } from "../src/core/memory/store.ts";
import { MemoryView } from "../src/modes/interactive/components/memory-view.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";

const tempDirs: string[] = [];
const services: MemoryService[] = [];

function settingsForView(): ResolvedMemorySettings {
  const dir = mkdtempSync(joinPath(tmpdir(), "msa-memory-view-"));
  tempDirs.push(dir);
  return {
    enabled: true,
    database: joinPath(dir, "memory.db"),
    embedding: {
      enabled: false,
      baseUrl: "http://127.0.0.1:1/v1",
      model: "test",
      queryPrefix: "",
      documentPrefix: "",
      timeoutMs: 500,
    },
    recall: { enabled: true, limit: 5, minScore: 0.35 },
  };
}

beforeAll(() => {
  initTheme(undefined, false);
});

afterEach(() => {
  for (const service of services.splice(0)) service.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup() {
  return runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const settings = settingsForView();
      const dir = tempDirs[tempDirs.length - 1] ?? "";
      const store = new MemoryStore(settings.database);
      const base = 1_700_000_000_000;
      store.save({
        content: "prefer pnpm over npm",
        kind: "preference" as const,
        scope: "project",
        project: resolveProjectName(dir),
        now: base + 2_000,
      });
      store.save({
        content: "the release goes to the Homebrew tap",
        kind: "fact" as const,
        scope: "project",
        project: resolveProjectName(dir),
        now: base + 1_000,
      });
      store.save({
        content: "answer in Japanese",
        kind: "preference" as const,
        scope: "global",
        project: null,
        now: base + 3_000,
      });
      store.close();
      const service = new MemoryService({ settings, cwd: dir });
      services.push(service);

      const onClose = vi.fn();
      const onError = vi.fn();
      const confirm = vi.fn((_message: string) => effectRunPromise(awaited(true)));
      const view = new MemoryView({
        service,
        onClose,
        confirm,
        onError,
        requestRender: () => {},
        maxHeight: () => 40,
      });
      const screen = () => view.render(100).map((line) => stripAnsi(line).trimEnd());
      return yield* awaited({ service, view, screen, onClose, onError, confirm });
    }),
  );
}

describe("MemoryView", () => {
  it("groups memories by scope and shows kind, content, and counts", () =>
    runTest(
      Effect.gen(function* () {
        const { screen } = yield* awaited(setup());
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
    ));

  it("opens a memory in detail and goes back", () =>
    runTest(
      Effect.gen(function* () {
        const { view, screen } = yield* awaited(setup());
        view.handleInput(ENTER);
        const detail = screen().join("\n");
        expect(detail).toContain("kind");
        expect(detail).toContain("timestamps");
        expect(detail).toContain("mem_");
        expect(detail).toContain("none (keyword search only)");
        view.handleInput(ESC);
        expect(screen().join("\n")).toContain("Global");
      }),
    ));

  it("forgets the selected memory after a confirmation and closes on escape", () =>
    runTest(
      Effect.gen(function* () {
        const { view, screen, onClose, confirm } = yield* awaited(setup());
        view.handleInput("d");
        yield* awaited(vi.waitFor(() => expect(confirm).toHaveBeenCalled()));
        expect(String(confirm.mock.calls[0]?.[0])).toContain("prefer pnpm over npm");
        yield* awaited(
          vi.waitFor(() => expect(screen().join("\n")).not.toContain("prefer pnpm over npm")),
        );
        view.handleInput(ESC);
        expect(onClose).toHaveBeenCalled();
      }),
    ));

  it("keeps the memory when the confirmation is declined", () =>
    runTest(
      Effect.gen(function* () {
        const { view, screen, confirm } = yield* awaited(setup());
        confirm.mockResolvedValueOnce(false);
        view.handleInput("d");
        yield* awaited(vi.waitFor(() => expect(confirm).toHaveBeenCalled()));
        expect(screen().join("\n")).toContain("prefer pnpm over npm");
      }),
    ));

  it("searches with / and returns to the full list with escape", () =>
    runTest(
      Effect.gen(function* () {
        const { view, screen } = yield* awaited(setup());
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
        expect(screen().join("\n")).toContain("answer in Japanese");
      }),
    ));

  it("adds a memory with a", () =>
    runTest(
      Effect.gen(function* () {
        const { view, screen } = yield* awaited(setup());
        view.handleInput("a");
        expect(screen().join("\n")).toContain("enter save");
        for (const key of "run verify before pushing") view.handleInput(key);
        view.handleInput(ENTER);
        yield* awaited(
          vi.waitFor(() => expect(screen().join("\n")).toContain("run verify before pushing")),
        );
        expect(screen().join("\n")).toContain("4 memories");
      }),
    ));

  it("moves the selection with the arrow keys", () =>
    runTest(
      Effect.gen(function* () {
        const { view, screen } = yield* awaited(setup());
        expect(screen().join("\n")).toContain("prefer pnpm over npm");
        view.handleInput(DOWN);
        view.handleInput(ENTER);
        expect(screen().join("\n")).toContain("the release goes to the Homebrew tap");
        expect(screen().join("\n")).not.toContain("prefer pnpm over npm");
      }),
    ));
});
