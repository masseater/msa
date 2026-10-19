import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vite-plus/test";

import { pendingHandoffs } from "../src/core/orchestrator/handoff-files.ts";
import { formatDateTime } from "../src/core/orchestrator/handoff-render.ts";
import { handoffResumePrompt } from "../src/modes/interactive/handoff-resume.ts";
import { harness } from "./orchestrator-harness.ts";

const directories: string[] = [];

afterEach(() => {
  for (const created of directories.splice(0)) rmSync(created, { recursive: true, force: true });
});

const sections = { premise: "p", goals: "g", donts: "d" };

async function handoffsInOrder(count: number) {
  const handoffDirectory = mkdtempSync(join(tmpdir(), "msa-handoff-resume-"));
  directories.push(handoffDirectory);
  const { orchestrator } = harness.setup({ handoffDirectory });
  const written: Awaited<ReturnType<typeof orchestrator.handoff>>[] = [];
  for (let index = 0; index < count; index++) {
    await orchestrator.createTask({ title: `task ${index}`, currentState: "a", goalState: "b" });
    written.push(await orchestrator.handoff(sections));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { handoffDirectory, written };
}

function answering(answer: "Yes" | "No" | "first" | "last" | undefined) {
  const asked: string[] = [];
  return {
    asked,
    select: (title: string, options: string[]) => {
      asked.push(`${title}\n${options.join("\n")}`);
      if (answer === "first") return Promise.resolve(options.at(0));
      if (answer === "last") return Promise.resolve(options.at(-1));
      return Promise.resolve(undefined);
    },
    confirm: (title: string, message: string) => {
      asked.push(`${title}\n${message}`);
      return Promise.resolve(answer === "Yes");
    },
  };
}

it("asks once about the only handoff, and takes it when the answer is yes", async () => {
  const { handoffDirectory, written } = await handoffsInOrder(1);
  const [pending] = await pendingHandoffs(handoffDirectory);
  const dialogs = answering("Yes");

  const prompt = await handoffResumePrompt(handoffDirectory, dialogs);

  expect(dialogs.asked).toEqual([
    `引き継ぎ\n${pending?.name}（${formatDateTime(pending?.createdAt ?? 0)}、タスク ${pending?.tasks} 本）を読んで再開しますか`,
  ]);
  expect(prompt).toContain(readFileSync(written[0]?.path ?? "", "utf8"));
  expect(await pendingHandoffs(handoffDirectory)).toEqual([]);
  expect(await handoffResumePrompt(handoffDirectory, answering("Yes"))).toBeUndefined();
});

it("does nothing when the answer is no, and asks again the next time", async () => {
  const { handoffDirectory, written } = await handoffsInOrder(1);

  const prompt = await handoffResumePrompt(handoffDirectory, answering("No"));

  expect(prompt).toBeUndefined();
  expect(existsSync(join(handoffDirectory, "consumed.json"))).toBe(false);
  const again = answering("No");
  await handoffResumePrompt(handoffDirectory, again);
  expect(again.asked).toHaveLength(1);
  expect((await pendingHandoffs(handoffDirectory)).map((handoff) => handoff.path)).toEqual([
    written[0]?.path,
  ]);
});

it("lists several handoffs newest first, and takes the one picked", async () => {
  const { handoffDirectory, written } = await handoffsInOrder(2);
  const dialogs = answering("first");

  const prompt = await handoffResumePrompt(handoffDirectory, dialogs);

  const [asked] = dialogs.asked;
  const lines = asked?.split("\n").slice(1) ?? [];
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain(written[1]?.path.split("/").at(-1));
  expect(lines[1]).toContain(written[0]?.path.split("/").at(-1));
  expect(prompt).toContain(`${written[1]?.path} を読んで再開する`);
  expect((await pendingHandoffs(handoffDirectory)).map((handoff) => handoff.path)).toEqual([
    written[0]?.path,
  ]);
});

it("takes nothing when the list is dismissed", async () => {
  const { handoffDirectory } = await handoffsInOrder(2);

  const prompt = await handoffResumePrompt(handoffDirectory, answering(undefined));

  expect(prompt).toBeUndefined();
  expect(await pendingHandoffs(handoffDirectory)).toHaveLength(2);
});

it("asks nothing when there is no handoff", async () => {
  const dialogs = answering("Yes");

  const prompt = await handoffResumePrompt(join(tmpdir(), "msa-no-such-handoffs"), dialogs);

  expect(prompt).toBeUndefined();
  expect(dialogs.asked).toEqual([]);
});
