import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MemoryService, type ResolvedMemorySettings } from "../src/core/memory/memory.ts";
import { MemoryView } from "../src/modes/interactive/components/memory-view.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";

const tempDirs: string[] = [];
const services: MemoryService[] = [];

function settingsForView(): ResolvedMemorySettings {
  const dir = mkdtempSync(join(tmpdir(), "msa-memory-view-"));
  tempDirs.push(dir);
  return {
    enabled: true,
    database: join(dir, "memory.db"),
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

async function setup() {
  const settings = settingsForView();
  const dir = tempDirs[tempDirs.length - 1] ?? "";
  const service = new MemoryService({ settings, cwd: dir });
  services.push(service);
  await service.save({ content: "the release goes to the Homebrew tap", kind: "fact" });
  await service.save({ content: "prefer pnpm over npm", kind: "preference" });
  await service.save({ content: "answer in Japanese", kind: "preference", scope: "global" });

  const onClose = vi.fn();
  const onError = vi.fn();
  const confirm = vi.fn(async (_message: string) => true);
  const view = new MemoryView({
    service,
    onClose,
    confirm,
    onError,
    requestRender: () => {},
    maxHeight: () => 40,
  });
  const screen = () => view.render(100).map((line) => stripAnsi(line).trimEnd());
  return { service, view, screen, onClose, onError, confirm };
}

describe("MemoryView", () => {
  it("groups memories by scope and shows kind, content, and counts", async () => {
    const { screen } = await setup();
    const text = screen().join("\n");
    expect(text).toContain("Memory");
    expect(text).toMatch(/Project \(msa-memory-view-\w+\)/);
    expect(text).toContain("Global");
    expect(text).toContain("the release goes to the Homebrew tap");
    expect(text).toContain("prefer pnpm over npm");
    expect(text).toContain("answer in Japanese");
    expect(text).toContain("3 memories");
    expect(text).toContain("0 embedded");
    expect(text).toContain("enter open");
  });

  it("opens a memory in detail and goes back", async () => {
    const { view, screen } = await setup();
    view.handleInput(ENTER);
    const detail = screen().join("\n");
    expect(detail).toContain("kind");
    expect(detail).toContain("timestamps");
    expect(detail).toContain("mem_");
    expect(detail).toContain("none (keyword search only)");
    view.handleInput(ESC);
    expect(screen().join("\n")).toContain("Global");
  });

  it("forgets the selected memory after a confirmation and closes on escape", async () => {
    const { view, screen, onClose, confirm } = await setup();
    view.handleInput("d");
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(String(confirm.mock.calls[0]?.[0])).toContain("the release goes to the Homebrew tap");
    await vi.waitFor(() =>
      expect(screen().join("\n")).not.toContain("the release goes to the Homebrew tap"),
    );
    view.handleInput(ESC);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the memory when the confirmation is declined", async () => {
    const { view, screen, confirm } = await setup();
    confirm.mockResolvedValueOnce(false);
    view.handleInput("d");
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(screen().join("\n")).toContain("the release goes to the Homebrew tap");
  });

  it("searches with / and returns to the full list with escape", async () => {
    const { view, screen } = await setup();
    view.handleInput("/");
    expect(screen().join("\n")).toContain("enter search");
    for (const key of "homebrew") view.handleInput(key);
    view.handleInput(ENTER);
    await vi.waitFor(() => expect(screen().join("\n")).toContain("search: homebrew"));
    await vi.waitFor(() => expect(screen().join("\n")).not.toContain("answer in Japanese"));
    expect(screen().join("\n")).toContain("the release goes to the Homebrew tap");
    view.handleInput(ESC);
    expect(screen().join("\n")).toContain("answer in Japanese");
  });

  it("adds a memory with a", async () => {
    const { view, screen } = await setup();
    view.handleInput("a");
    expect(screen().join("\n")).toContain("enter save");
    for (const key of "run verify before pushing") view.handleInput(key);
    view.handleInput(ENTER);
    await vi.waitFor(() => expect(screen().join("\n")).toContain("run verify before pushing"));
    expect(screen().join("\n")).toContain("4 memories");
  });

  it("moves the selection with the arrow keys", async () => {
    const { view, screen } = await setup();
    view.handleInput(DOWN);
    view.handleInput(ENTER);
    expect(screen().join("\n")).toContain("prefer pnpm over npm");
    expect(screen().join("\n")).not.toContain("the release goes to the Homebrew tap");
  });
});
