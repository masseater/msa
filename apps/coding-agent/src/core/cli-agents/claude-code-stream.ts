import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import { Effect } from "effect";

import claudeAccounts from "./claude-accounts.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";
import claudeCodeRun from "./claude-code-run.ts";
import type claudeCodeSessionTypes from "./claude-code-session.types.ts";
import replyModule from "./reply.ts";

const { blockOf, loadAccounts } = claudeAccounts;
const { run } = claudeCodeRun;
const { createReply } = replyModule;
const { getCurrentSystemPrompt, getCurrentTools } = compat;

const EFFORT: Record<string, claudeCodeSessionTypes.Effort> = {
  high: "high",
  low: "low",
  max: "max",
  medium: "medium",
  minimal: "low",
  xhigh: "xhigh",
};

const usableAccounts = (fixed: claudeAccountsTypes.Account | undefined) =>
  fixed === undefined
    ? loadAccounts().filter((account) => account.auto !== false && blockOf(account) === undefined)
    : [fixed];

const streamFor =
  (fixed?: claudeAccountsTypes.Account) =>
  (
    model: compatTypes.Model<string>,
    context: compatTypes.TranscriptContext,
    options?: compatTypes.SimpleStreamOptions,
  ) => {
    const reply = createReply(model);
    const { messages } = context;
    const config: claudeCodeSessionTypes.SessionConfig = {
      accounts: usableAccounts(fixed),
      effort: options?.reasoning === undefined ? undefined : EFFORT[options.reasoning],
      model: model.id,
      systemPrompt: getCurrentSystemPrompt(messages),
      tools: getCurrentTools(messages),
    };
    Effect.runFork(run({ config, fixed, messages, model, options, reply }));
    return reply.stream;
  };

const claudeCodeStream = { streamFor };

export default claudeCodeStream;
