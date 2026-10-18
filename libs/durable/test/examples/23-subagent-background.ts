import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { type FauxResponseStep } from "@msa/ai";
import { createModels } from "@msa/ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@msa/ai/providers/faux";
import { openaiProvider } from "@msa/ai/providers/openai";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Console, Effect } from "effect";

import { environmentVariable } from "../../src/env/node-process.ts";
import { createRegistry, Harness, watchEvents } from "../../src/harness/index.ts";
import { type AgentEvent, type ConversationId, LiveDoc } from "../../src/index.ts";
import { openNodeSqliteStorage } from "../../src/storage/sqlite/node.ts";
import { awaited } from "../effect-support.ts";
import { joinPath, makeTempDir, removeDir } from "../platform-support.ts";
import { Subagents, textOf, SubagentTools } from "./subagent-background-tools.ts";

const context = BACKGROUND_CONTEXT;

const models = createModels();
let model = { provider: "openai", modelId: "gpt-6-sol" };
if (environmentVariable("OPENAI_API_KEY", true) === undefined) {
  const faux = fauxProvider({ tokensPerSecond: 50 });
  models.setProvider(faux.provider);
  model = { provider: "faux", modelId: "faux-1" };
  const call = (input: Record<string, string>) =>
    fauxAssistantMessage([fauxToolCall("subagent", input)], { stopReason: "toolUse" });
  const answer = (text: string) => fauxAssistantMessage([fauxText(text)]);
  const route: FauxResponseStep = (request) => {
    const last = request.messages.findLast((message) => message.role !== "system")!;
    const content =
      typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
    const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (last.role === "toolResult") return answer(`OK. ${text}`);
    if (text.includes("Start a subagent")) {
      return call({ action: "spawn", name: "reader", message: "Summarize the plot of Moby Dick." });
    }
    if (text.includes("whale's name"))
      return call({ action: "send", name: "reader", message: "What is the whale called?" });
    if (text.includes("every chapter")) {
      return call({
        action: "send",
        name: "reader",
        message: "Now go through all chapters in detail.",
      });
    }
    if (text.includes("Stop reader")) return call({ action: "stop", name: "reader" });
    if (text.includes("my subagents")) return call({ action: "status" });
    if (text.includes("[subagent")) return answer("Noted.");
    if (text.includes("Summarize the plot")) return answer("A whale, a captain, an obsession.");
    if (text.includes("whale called")) return answer("Moby Dick.");
    const chapters = Array.from(
      { length: 135 },
      (_, index) => `Chapter ${index + 1}: more whaling.`,
    );
    return answer(chapters.join("\n"));
  };
  faux.setResponses(Array.from({ length: 40 }, () => route));
} else {
  models.setProvider(openaiProvider());
}
const registry = createRegistry();
registry.install(SubagentTools);

const main = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-durable-subagents-");
  const open = Effect.fn("open")(function* () {
    const harness = yield* awaited(
      Harness.open(
        yield* awaited(openNodeSqliteStorage(joinPath(directory, "session.sqlite"))),
        { models, registry },
        context,
      ),
    );
    const root = yield* awaited(harness.root(context, { agent: { model } }));
    return { harness, root };
  });

  const color = (code: number) => (text: string) =>
    process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
  const bold = color(1);
  const dim = color(2);
  const cyan = color(36);
  const yellow = color(33);
  const magenta = color(35);

  function contentText(content: string | readonly { type: string; text?: string }[]): string {
    return typeof content === "string"
      ? content
      : content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("");
  }

  const follow = Effect.fn("follow")(function* (harness: Harness, id: ConversationId) {
    const runSync = Effect.runSyncWith(yield* Effect.context<never>());

    const stream = yield* awaited(watchEvents(harness, id, context));
    stream.start((events: readonly AgentEvent[]) => {
      for (const event of events) {
        if (event.type !== "message_end") continue;
        const message = event.entry.model?.[0];
        if (message?.role === "user") {
          const text = contentText(message.content);
          const report = /^\[subagent (\S+) ([^\]]*)\] ?(.*)$/su.exec(text);
          if (report === null) runSync(Console.log(`\n${cyan(bold(">"))} ${bold(text)}`));
          else
            runSync(Console.log(`\n${magenta(bold(`> ${report[1]}:`))} ${report[3] || report[2]}`));
        } else if (message?.role === "assistant") {
          for (const part of message.content) {
            if (part.type !== "toolCall") continue;
            const {
              action,
              name,
              message: sent,
            } = part.arguments as Record<string, string | undefined>;
            const quoted = sent === undefined ? "" : ` ${JSON.stringify(sent)}`;
            runSync(
              Console.log(
                yellow(`  ${part.name} ${action}${name === undefined ? "" : ` ${name}`}${quoted}`),
              ),
            );
          }
          if (textOf(message) !== "") runSync(Console.log(textOf(message)));
        } else if (message?.role === "toolResult") {
          runSync(Console.log(dim(`  → ${contentText(message.content)}`)));
        }
      }

      return Promise.resolve();
    });
  });

  let { harness, root } = yield* open();
  yield* follow(harness, root.id);

  const say = Effect.fn("say")(function* (text: string) {
    yield* awaited(
      (yield* awaited(root.submit({ type: "input", content: text }, context))).wait(context),
    );
  });
  const settle = Effect.fn("settle")(function* () {
    const reporters =
      (yield* awaited(harness.snapshot(Subagents, root.id, context)))?.reporters ?? {};
    for (const id of Object.values(reporters)) yield* awaited(harness.waitForTask(id, context));
    yield* awaited(root.waitForIdle(context));
    yield* Effect.sleep(50);
  });
  const until = Effect.fn("until")(function* (check: Effect.Effect<boolean>) {
    for (let tries = 0; tries < 1000 && !(yield* check); tries++) yield* Effect.sleep(10);
  });
  const working = (name: string): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const agent = (yield* awaited(harness.snapshot(Subagents, root.id, context)))?.agents[name];
      return (
        agent !== undefined &&
        (yield* awaited(harness.snapshot(LiveDoc, agent.conversationId, context)))?.run !==
          undefined
      );
    });

  yield* say("Start a subagent named reader that summarizes Moby Dick.");
  yield* settle();

  yield* say("Ask reader to summarize every chapter.");
  yield* until(working("reader"));
  yield* say("Stop reader.");
  yield* settle();

  yield* say("What are my subagents doing?");
  yield* settle();

  const reporters = Effect.gen(function* () {
    return Object.keys(
      (yield* awaited(harness.snapshot(Subagents, root.id, context)))?.reporters ?? {},
    ).length;
  });
  const before = yield* reporters;
  yield* awaited(
    root.submit({ type: "input", content: "Ask reader for the whale's name." }, context),
  );
  yield* until(Effect.map(reporters, (count) => count > before));
  yield* awaited(harness.close(context));
  yield* Console.log(dim("\n  (process restarts)"));
  ({ harness, root } = yield* open());
  yield* follow(harness, root.id);
  yield* settle();

  yield* awaited(harness.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);
