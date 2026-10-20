import type compatTypes from "@msa/ai/compat.types";
import { Cause, Effect } from "effect";

import claudeAccounts from "./claude-accounts.ts";
import type claudeAccountsTypes from "./claude-accounts.types.ts";
import claudeCodeAttach from "./claude-code-attach.ts";
import claudeCodePump from "./claude-code-pump.ts";
import type claudeCodeSessionTypes from "./claude-code-session.types.ts";
import type replyTypes from "./reply.types.ts";

const { blockIfUnusable, blockOf, loadAccounts } = claudeAccounts;
const { PROVIDER_ID, attach } = claudeCodeAttach;
const { pump } = claudeCodePump;

interface RunRequest {
  readonly config: claudeCodeSessionTypes.SessionConfig;
  readonly fixed: claudeAccountsTypes.Account | undefined;
  readonly messages: readonly compatTypes.Message[];
  readonly model: compatTypes.Model<string>;
  readonly options: compatTypes.SimpleStreamOptions | undefined;
  readonly reply: replyTypes.ReplyBuilder;
}

interface RunState {
  session: claudeCodeSessionTypes.Session | undefined;
}

interface AccountFailure {
  readonly failed: claudeAccountsTypes.Account;
  readonly failure: claudeAccountsTypes.RunFailure;
}

function noAccountMessage(failures: readonly string[]): string {
  const failed = new Set(failures.map((line) => line.slice(0, line.indexOf(":"))));
  const blocked = loadAccounts()
    .filter((candidate) => candidate.auto !== false && !failed.has(candidate.name))
    .map((candidate) => `${candidate.name}: ${blockOf(candidate)?.reason ?? "?"}`);
  return `No Claude account available.\n${[...failures, ...blocked].join("\n")}`;
}

const runAccount = (request: RunRequest, state: RunState, account: claudeAccountsTypes.Account) =>
  Effect.gen(function* () {
    const attached = yield* attach(request.messages, request.config).pipe(
      Effect.map((session) => ({ session })),
      Effect.catch((error) => Effect.succeed({ error: error.message })),
    );
    if ("error" in attached) return { failed: account, failure: { error: attached.error } };
    const { session } = attached;
    state.session = session;
    const failure = yield* pump(session, request.reply, request.model, request.options);
    if (failure === undefined || (request.options?.signal?.aborted ?? false)) return undefined;
    session.close();
    state.session = undefined;
    return { failed: session.account, failure } satisfies AccountFailure;
  });

const runAccounts = (request: RunRequest, state: RunState) =>
  Effect.gen(function* () {
    const { config, reply } = request;
    const failures: string[] = [];
    while (true) {
      const account = config.accounts[0];
      if (account === undefined) {
        reply.fail("error", noAccountMessage(failures));
        return;
      }
      const outcome = yield* runAccount(request, state, account);
      if (outcome === undefined) return;
      const { failed, failure } = outcome;
      const blocked = blockIfUnusable(failed, failure);
      const detail = `${failed.name}: ${failure.error}`;
      failures.push(detail);
      if (request.fixed !== undefined || !blocked || reply.hasContent) {
        reply.fail("error", detail);
        return;
      }
      config.accounts = config.accounts.filter((candidate) => candidate.name !== failed.name);
    }
  });

const notifyPayload = (request: RunRequest) => {
  const { config, model, options } = request;
  const payload = {
    provider: PROVIDER_ID,
    ...config,
    tools: config.tools.map((tool) => tool.name),
  };
  return Effect.ignore(
    Effect.tryPromise(() => Promise.resolve(options?.onPayload?.(payload, model))),
  );
};

const run = (request: RunRequest): Effect.Effect<void> => {
  const { options, reply } = request;
  const state: RunState = { session: undefined };
  const onAbort = () => {
    state.session?.interrupt();
    state.session?.close();
    reply.fail("aborted", "aborted");
  };
  const signal = options?.signal;
  if (signal?.aborted === true) return Effect.sync(onAbort);
  signal?.addEventListener("abort", onAbort, { once: true });
  return Effect.andThen(notifyPayload(request), runAccounts(request, state)).pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const error = Cause.squash(cause);
        state.session?.close();
        reply.fail("error", error instanceof Error ? error.message : String(error));
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        signal?.removeEventListener("abort", onAbort);
        if (state.session === undefined) return;
        state.session.busy = false;
        state.session.touch();
      }),
    ),
  );
};

const claudeCodeRun = { run };

export default claudeCodeRun;
