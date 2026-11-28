import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

type Content = Parameters<codingAgentTypes.ExtensionAPI["sendUserMessage"]>[0];

type WhenBusy =
  | { readonly refuse: string }
  | { readonly deliverAs: "steer" | "followUp"; readonly notice?: string };

interface MessageCommand {
  readonly content: (args: string) => Content;
  readonly description: string;
  readonly name: string;
  readonly whenBusy: WhenBusy;
}

const plain = (args: string): Content => args;

const messageCommands: readonly MessageCommand[] = [
  {
    content: plain,
    description: "Send a user message to the agent",
    name: "ask",
    whenBusy: { refuse: "Agent is busy. Use /steer or /followup instead." },
  },
  {
    content: plain,
    description: "Send a steering message (interrupts current processing)",
    name: "steer",
    whenBusy: { deliverAs: "steer" },
  },
  {
    content: plain,
    description: "Queue a follow-up message (waits for current processing)",
    name: "followup",
    whenBusy: { deliverAs: "followUp", notice: "Follow-up queued" },
  },
  {
    content: (args) => [
      { text: `User request: ${args}`, type: "text" },
      { text: "Please respond concisely.", type: "text" },
    ],
    description: "Send a user message with structured content",
    name: "askwith",
    whenBusy: { refuse: "Agent is busy" },
  },
];

const registerMessageCommand = (
  msa: codingAgentTypes.ExtensionAPI,
  { content, description, name, whenBusy }: MessageCommand,
): void => {
  msa.registerCommand(name, {
    description,
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.sync(() => {
          if (args.trim().length === 0) {
            ctx.ui.notify(`Usage: /${name} <message>`, "warning");
            return;
          }

          if (ctx.isIdle()) {
            msa.sendUserMessage(content(args));
            return;
          }

          if ("refuse" in whenBusy) {
            ctx.ui.notify(whenBusy.refuse, "warning");
            return;
          }

          msa.sendUserMessage(content(args), { deliverAs: whenBusy.deliverAs });
          if (whenBusy.notice !== undefined) ctx.ui.notify(whenBusy.notice, "info");
        }),
      ),
  });
};

export default function (msa: codingAgentTypes.ExtensionAPI) {
  for (const command of messageCommands) registerMessageCommand(msa, command);
}
