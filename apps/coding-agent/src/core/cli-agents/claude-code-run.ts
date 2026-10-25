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

const rotationAccounts = (): Promise<claudeAccountsTypes.Account[]> =>
  loadAccounts().then((accounts) => accounts.filter((account) => account.auto !== false));

const usableAccounts = (
  fixed: claudeAccountsTypes.Account | undefined,
): Promise<claudeAccountsTypes.Account[]> =>
  fixed === undefined
    ? rotationAccounts().then((accounts) =>
        Promise.all(accounts.map((account) => blockOf(account))).then((blocks) =>
          accounts.filter((_account, index) => blocks[index] === undefined),
        ),
      )
    : Promise.resolve([fixed]);

interface NoAccount {
  readonly message: string;
  readonly resetsAt: number | undefined;
}

function noAccount(failures: readonly string[]): Promise<NoAccount> {
  const failed = new Set(failures.map((line) => line.slice(0, line.indexOf(":"))));
  return rotationAccounts()
    .then((accounts) =>
      Promise.all(
        accounts.map((account) => blockOf(account).then((block) => ({ account, block }))),
      ),
    )
    .then((blocks) => {
      const blocked = blocks
        .filter(({ account }) => !failed.has(account.name))
        .map(({ account, block }) => `${account.name}: ${block?.reason ?? "?"}`);
      const until = blocks.flatMap(({ block }) => (block === undefined ? [] : [block.until]));
      return {
        message: `No Claude account available.\n${[...failures, ...blocked].join("\n")}`,
        resetsAt:
          until.length === blocks.length && until.length > 0 ? Math.min(...until) : undefined,
      };
    });
}

const limitResetsAt = (account: claudeAccountsTypes.Account, failure: AccountFailure["failure"]) =>
  failure.cause === "usage_limit"
    ? blockOf(account).then((block) => block?.until ?? failure.resetsAt)
    : Promise.resolve(undefined);

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
        const none = yield* Effect.promise(() => noAccount(failures));
        reply.fail("error", none.message, none.resetsAt);
        return;
      }
      const outcome = yield* runAccount(request, state, account);
      if (outcome === undefined) return;
      const { failed, failure } = outcome;
      const blocked = yield* Effect.promise(() => blockIfUnusable(failed, failure));
      const detail = `${failed.name}: ${failure.error}`;
      failures.push(detail);
      if (request.fixed !== undefined || !blocked || reply.hasContent) {
        reply.fail("error", detail, yield* Effect.promise(() => limitResetsAt(failed, failure)));
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
  const assignAccounts = Effect.flatMap(
    Effect.promise(() => usableAccounts(request.fixed)),
    (accounts) =>
      Effect.sync(() => {
        request.config.accounts = accounts;
      }),
  );
  return Effect.andThen(
    Effect.andThen(assignAccounts, notifyPayload(request)),
    runAccounts(request, state),
  ).pipe(
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
