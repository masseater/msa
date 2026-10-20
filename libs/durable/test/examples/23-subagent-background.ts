import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import {
  type FauxResponseStep,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import { openaiProvider } from "@msa/ai/providers/openai";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Console, Effect } from "effect";

import node from "../../src/storage/sqlite/node.ts";
import support from "../support.ts";
import subagentBackgroundTools from "./subagent-background-tools.ts";

const { Harness, createRegistry, watchEvents } = harnessModule;
const { openNodeSqliteStorage } = node;
const { LiveDoc } = durable;

const { BACKGROUND_CONTEXT, awaited, environmentVariable, joinPath, makeTempDir, removeDir } =
  support;
const { SubagentTools, Subagents, textOf } = subagentBackgroundTools;

const context = BACKGROUND_CONTEXT;

const models = createModels();
let model = { modelId: "gpt-6-sol", provider: "openai" };
if (environmentVariable("OPENAI_API_KEY", true) === undefined) {
  const faux = fauxProvider({ tokensPerSecond: 50 });
  models.setProvider(faux.provider);
  model = { modelId: "faux-1", provider: "faux" };
  const call = (input: Record<string, string>) =>
    fauxAssistantMessage([fauxToolCall("subagent", input)], { stopReason: "toolUse" });
  const answer = (text: string) => fauxAssistantMessage([fauxText(text)]);
  const route: FauxResponseStep = (request) => {
    const last = request.messages.findLast((message) => message.role !== "system")!;
    const content =
      typeof last.content === "string" ? [{ text: last.content, type: "text" }] : last.content;
    const text = content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
    if (last.role === "toolResult") return answer(`OK. ${text}`);
    if (text.includes("Start a subagent")) {
      return call({ action: "spawn", message: "Summarize the plot of Moby Dick.", name: "reader" });
    }
    if (text.includes("whale's name"))
      return call({ action: "send", message: "What is the whale called?", name: "reader" });
    if (text.includes("every chapter")) {
      return call({
        action: "send",
        message: "Now go through all chapters in detail.",
        name: "reader",
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

const open = Effect.fn("open")(function* (directory: string) {
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

type Session = Effect.Success<ReturnType<typeof open>>;

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

const print = (line: string): void => Effect.runSync(Console.log(line));

function printEvent(event: durableTypes.AgentEvent): void {
  if (event.type !== "message_end") return;
  const message = event.entry.model?.[0];
  if (message?.role === "user") {
    const text = contentText(message.content);
    const report = /^\[subagent (\S+) ([^\]]*)\] ?(.*)$/su.exec(text);
    if (report === null) print(`\n${cyan(bold(">"))} ${bold(text)}`);
    else print(`\n${magenta(bold(`> ${report[1]}:`))} ${report[3] || report[2]}`);
  } else if (message?.role === "assistant") {
    for (const part of message.content) {
      if (part.type !== "toolCall") continue;
      const { action, name, message: sent } = part.arguments as Record<string, string | undefined>;
      const quoted = sent === undefined ? "" : ` ${JSON.stringify(sent)}`;
      print(yellow(`  ${part.name} ${action}${name === undefined ? "" : ` ${name}`}${quoted}`));
    }
    if (textOf(message) !== "") print(textOf(message));
  } else if (message?.role === "toolResult") {
    print(dim(`  → ${contentText(message.content)}`));
  }
}

const follow = Effect.fn("follow")(function* ({ harness, root }: Session) {
  const stream = yield* awaited(watchEvents(harness, root.id, context));
  stream.start((events: readonly durableTypes.AgentEvent[]) => {
    for (const event of events) printEvent(event);

    return Promise.resolve();
  });
});

const say = Effect.fn("say")(function* ({ root }: Session, text: string) {
  yield* awaited(
    (yield* awaited(root.submit({ content: text, type: "input" }, context))).wait(context),
  );
});

const settle = Effect.fn("settle")(function* ({ harness, root }: Session) {
  const reporters =
    (yield* awaited(harness.snapshot(Subagents, root.id, context)))?.reporters ?? {};
  for (const id of Object.values(reporters)) yield* awaited(harness.waitForTask(id, context));
  yield* awaited(root.waitForIdle(context));
  yield* Effect.sleep(50);
});

const until = Effect.fn("until")(function* (check: Effect.Effect<boolean>) {
  for (let tries = 0; tries < 1000 && !(yield* check); tries++) yield* Effect.sleep(10);
});

const working = ({ harness, root }: Session, name: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const agent = (yield* awaited(harness.snapshot(Subagents, root.id, context)))?.agents[name];
    return (
      agent !== undefined &&
      (yield* awaited(harness.snapshot(LiveDoc, agent.conversationId, context)))?.run !== undefined
    );
  });

const reporterCount = ({ harness, root }: Session): Effect.Effect<number> =>
  Effect.gen(function* () {
    return Object.keys(
      (yield* awaited(harness.snapshot(Subagents, root.id, context)))?.reporters ?? {},
    ).length;
  });

const converse = Effect.fn("converse")(function* (session: Session) {
  yield* say(session, "Start a subagent named reader that summarizes Moby Dick.");
  yield* settle(session);

  yield* say(session, "Ask reader to summarize every chapter.");
  yield* until(working(session, "reader"));
  yield* say(session, "Stop reader.");
  yield* settle(session);

  yield* say(session, "What are my subagents doing?");
  yield* settle(session);

  const before = yield* reporterCount(session);
  yield* awaited(
    session.root.submit({ content: "Ask reader for the whale's name.", type: "input" }, context),
  );
  yield* until(Effect.map(reporterCount(session), (count) => count > before));
});

const main = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-durable-subagents-");
  const first = yield* open(directory);
  yield* follow(first);
  yield* converse(first);
  yield* awaited(first.harness.close(context));
  yield* Console.log(dim("\n  (process restarts)"));
  const second = yield* open(directory);
  yield* follow(second);
  yield* settle(second);

  yield* awaited(second.harness.close(context));
  yield* removeDir(directory);
});

NodeRuntime.runMain(main);
