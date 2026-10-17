import { rm } from "node:fs/promises";

import { createModels, fauxAssistantMessage } from "@msa/ai";
import { AssistantEntry, LiveDoc } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { type ChatSetup, chatSetup, textOf, unanswered, waitFor } from "./chat-support.ts";
import { open, directories, sqlitePath } from "./harness-generation-recovery-support.ts";
import { addSection } from "./harness-support.ts";
import { context } from "./session-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

describe("generation recovery", () => {
  it("fails no_model when the pinned model is gone after reopen, in request and in poll", async () => {
    const path = await sqlitePath();
    const setup = chatSetup({ deferred: { pollAfterMs: 60_000 } });
    const busy = unanswered();
    setup.faux.setResponses([busy.step, fauxAssistantMessage("deferred")]);
    let opened = await open(path, setup);
    opened.harness.resume();
    const requesting = (await opened.root.submit({ type: "input", content: "one" }, context)).id;
    await busy.reached;
    await opened.harness.close(context);

    // Reopened without the faux provider: the request's pinned model is unknown.
    const empty: ChatSetup = { ...setup, models: createModels() };
    opened = await open(path, empty);
    opened.harness.resume();
    expect(
      await (await opened.harness.submission(requesting, context))!.wait(context),
    ).toMatchObject({
      status: "unanswered",
      reason: "no_model",
    });
    await opened.harness.close(context);

    opened = await open(path, setup);
    setup.settings.stream = { deferred: true };
    opened.harness.resume();
    const polling = (await opened.root.submit({ type: "input", content: "two" }, context)).id;
    await waitFor(async () => {
      const live = await opened.harness.snapshot(LiveDoc, opened.root.id, context);
      return live?.generation?.deferred !== undefined;
    });
    await opened.harness.close(context);

    opened = await open(path, empty);
    opened.harness.resume();
    expect(await (await opened.harness.submission(polling, context))!.wait(context)).toMatchObject({
      status: "unanswered",
      reason: "no_model",
    });
    await opened.harness.close(context);
  });
});

describe("generation recovery", () => {
  it("runs a print-style turn and reads the durable answer after reopen", async () => {
    const path = await sqlitePath();
    const setup = chatSetup();
    addSection(setup.registry, "preamble", () => "You are terse.", { tag: false });
    setup.faux.setResponses([fauxAssistantMessage("42")]);
    let opened = await open(path, setup);
    opened.harness.resume();
    const submission = await opened.root.submit({ type: "input", content: "answer?" }, context);
    const settled = await submission.wait(context);
    if (settled.status !== "done" || settled.type !== "input")
      throw new Error(`Unexpected ${settled.status}`);
    const answer = await opened.root.commit(
      (tx) => tx.entry(AssistantEntry, settled.answer),
      context,
    );
    expect(textOf(answer?.model?.[0])).toBe("42");
    await opened.harness.close(context);

    opened = await open(path, setup);
    expect(
      await (await opened.harness.submission(submission.id, context))!.status(context),
    ).toEqual(settled);
    expect(
      await opened.root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
    ).toEqual(answer);
    await opened.harness.close(context);
  });
});
