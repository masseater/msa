import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import handoffFiles from "../src/core/orchestrator/handoff-files.ts";
import platform from "../src/core/platform/index.ts";
import handoffResume from "../src/modes/interactive/handoff-resume.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { pendingHandoffs } = handoffFiles;
const { handoffResumePrompt } = handoffResume;
const { formatLocalDateTime } = platform;

const { awaited, joinPath, makeTempDir, pathExists, readTextFile, removePath, runTest } = testing;

const { harness } = orchestratorHarness;

const directories: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const created of directories.splice(0)) yield* removePath(created);
    }),
  ),
);

const sections = { donts: "d", goals: "g", premise: "p" };

function handoffsInOrder(count: number) {
  return runTest(
    Effect.gen(function* () {
      const handoffDirectory = yield* makeTempDir("msa-handoff-resume-");
      directories.push(handoffDirectory);
      const { orchestrator } = harness.setup({ handoffDirectory });
      const written: Awaited<ReturnType<typeof orchestrator.handoff>>[] = [];
      for (let index = 0; index < count; index++) {
        yield* awaited(
          orchestrator.createTask({ currentState: "a", goalState: "b", title: `task ${index}` }),
        );
        written.push(yield* awaited(orchestrator.handoff(sections)));
        yield* Effect.sleep(5);
      }
      return { handoffDirectory, written };
    }),
  );
}

function answering(answer: "Yes" | "No" | "first" | "last" | undefined) {
  const asked: string[] = [];
  return {
    asked,
    confirm: (title: string, message: string) => {
      asked.push(`${title}\n${message}`);
      return Promise.resolve(answer === "Yes");
    },
    select: (title: string, options: string[]) => {
      asked.push(`${title}\n${options.join("\n")}`);
      if (answer === "first") return Promise.resolve(options.at(0));
      if (answer === "last") return Promise.resolve(options.at(-1));
      return Promise.resolve(undefined);
    },
  };
}

it("asks once about the only handoff, and takes it when the answer is yes", () =>
  runTest(
    Effect.gen(function* () {
      const { handoffDirectory, written } = yield* awaited(handoffsInOrder(1));
      const [pending] = yield* awaited(pendingHandoffs(handoffDirectory));
      const dialogs = answering("Yes");

      const prompt = yield* awaited(handoffResumePrompt(handoffDirectory, dialogs));

      expect(dialogs.asked).toEqual([
        `引き継ぎ\n${pending?.name}（${formatLocalDateTime(pending?.createdAt ?? 0)}、タスク ${pending?.tasks} 本）を読んで再開しますか`,
      ]);
      expect(prompt).toContain(yield* readTextFile(written[0]?.path ?? ""));
      expect(yield* awaited(pendingHandoffs(handoffDirectory))).toEqual([]);
      expect(
        yield* awaited(handoffResumePrompt(handoffDirectory, answering("Yes"))),
      ).toBeUndefined();
    }),
  ));

it("does nothing when the answer is no, and asks again the next time", () =>
  runTest(
    Effect.gen(function* () {
      const { handoffDirectory, written } = yield* awaited(handoffsInOrder(1));

      const prompt = yield* awaited(handoffResumePrompt(handoffDirectory, answering("No")));

      expect(prompt).toBeUndefined();
      expect(yield* pathExists(joinPath(handoffDirectory, "consumed.json"))).toBe(false);
      const again = answering("No");
      yield* awaited(handoffResumePrompt(handoffDirectory, again));
      expect(again.asked).toHaveLength(1);
      expect(
        (yield* awaited(pendingHandoffs(handoffDirectory))).map((handoff) => handoff.path),
      ).toEqual([written[0]?.path]);
    }),
  ));

it("lists several handoffs newest first, and takes the one picked", () =>
  runTest(
    Effect.gen(function* () {
      const { handoffDirectory, written } = yield* awaited(handoffsInOrder(2));
      const dialogs = answering("first");

      const prompt = yield* awaited(handoffResumePrompt(handoffDirectory, dialogs));

      const [asked] = dialogs.asked;
      const lines = asked?.split("\n").slice(1) ?? [];
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain(written[1]?.path.split("/").at(-1));
      expect(lines[1]).toContain(written[0]?.path.split("/").at(-1));
      expect(prompt).toContain(`${written[1]?.path} を読んで再開する`);
      expect(
        (yield* awaited(pendingHandoffs(handoffDirectory))).map((handoff) => handoff.path),
      ).toEqual([written[0]?.path]);
    }),
  ));

const takesNothingWhenTheListIsDismissed = () =>
  runTest(
    Effect.gen(function* () {
      const { handoffDirectory } = yield* awaited(handoffsInOrder(2));

      const prompt = yield* awaited(handoffResumePrompt(handoffDirectory, answering(undefined)));

      expect(prompt).toBeUndefined();
      expect(yield* awaited(pendingHandoffs(handoffDirectory))).toHaveLength(2);
    }),
  );

it("takes nothing when the list is dismissed", takesNothingWhenTheListIsDismissed);

it("asks nothing when there is no handoff", () =>
  runTest(
    Effect.gen(function* () {
      const dialogs = answering("Yes");

      const prompt = yield* awaited(
        handoffResumePrompt(joinPath(tmpdir(), "msa-no-such-handoffs"), dialogs),
      );

      expect(prompt).toBeUndefined();
      expect(dialogs.asked).toEqual([]);
    }),
  ));
