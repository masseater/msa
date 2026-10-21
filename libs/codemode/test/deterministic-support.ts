import { Effect, Schedule } from "effect";
import { dual } from "effect/Function";

import codemode from "../src/index.ts";
import type codemodeTypes from "../src/index.types.ts";
import type deterministicSupportTypes from "./deterministic-support.types.ts";

const { CodemodeSandbox, RemoteCodemodeSandbox, loadQuickJSWasm, serveCodemodeRemote } = codemode;

const BUDGET = 50_000;

function makeRemote(
  options: codemodeTypes.CodemodeSandboxBaseOptions,
  delayFirst: boolean,
): codemodeTypes.RemoteCodemodeSandbox {
  return new RemoteCodemodeSandbox({
    ...options,
    remote: () => ({
      execute: (request, exchange) => {
        const wrapped: codemodeTypes.CodemodeRemoteExchange = (messages) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const reply = structuredClone(
                yield* Effect.promise(() => exchange(structuredClone(messages))),
              );
              if (delayFirst && reply?.type === "result" && reply.seq === 1)
                yield* Effect.sleep(30);
              return reply;
            }),
          );
        return serveCodemodeRemote(structuredClone(request), wrapped, {
          maxInterruptBudget: BUDGET,
          wasm: loadQuickJSWasm(),
        });
      },
    }),
  });
}

function remoteDelayingFirst(
  options: codemodeTypes.CodemodeSandboxBaseOptions,
): codemodeTypes.RemoteCodemodeSandbox {
  return makeRemote(options, true);
}

const BACKENDS: Record<string, deterministicSupportTypes.Create> = {
  remote: (options = {}) => makeRemote(options, false),
  worker: (options = {}) => new CodemodeSandbox(options),
};

const STARTED_AT = Date.UTC(2026, 0, 15, 10, 0, 0);

function startRecorded(
  sandbox: codemodeTypes.CodemodeSandboxBase,
  code: string,
  options: deterministicSupportTypes.StartOptions = {},
): deterministicSupportTypes.Recorded {
  const calls: codemodeTypes.CodemodeHostCall[] = [];
  const idles: [number, number][] = [];
  const events: string[] = [];
  let fingerprint: string | undefined;
  let seq = 0;
  const answer =
    options.answer ?? ((call: codemodeTypes.CodemodeHostCall) => ({ ok: true, value: call.args }));
  const run: codemodeTypes.CodemodeRun = sandbox.start(code, {
    seed: 1,
    startedAt: STARTED_AT,
    timeoutMs: 20_000,
    tools: [{ name: "echo" }, { name: "wait" }],
    ...options,
    onCall: (call) => {
      calls.push(call);
      events.push(`call ${call.id}`);
      if (call.name === "wait") return;
      queueMicrotask(() => {
        seq++;
        run.deliver(seq, STARTED_AT + 1000 * seq, call.id, answer(call));
      });
    },
    onIdle: (idleSeq, issued) => {
      idles.push([idleSeq, issued]);
      events.push(`idle ${idleSeq}`);
    },
    onStarted: (value) => {
      fingerprint = value;
      events.push("started");
    },
  });
  return { calls, events, fingerprint: () => fingerprint, idles, run };
}

const start: {
  (
    code: string,
    options?: deterministicSupportTypes.StartOptions,
  ): (sandbox: codemodeTypes.CodemodeSandboxBase) => deterministicSupportTypes.Recorded;
  (
    sandbox: codemodeTypes.CodemodeSandboxBase,
    code: string,
    options?: deterministicSupportTypes.StartOptions,
  ): deterministicSupportTypes.Recorded;
} = dual((args) => typeof args[0] !== "string", startRecorded);

const conditionReached = (check: () => boolean): Effect.Effect<void, string> =>
  Effect.suspend(() => (check() ? Effect.void : Effect.fail("not yet")));

const waitFor = (check: () => boolean): Effect.Effect<void> =>
  conditionReached(check).pipe(
    Effect.retry(Schedule.spaced(5)),
    Effect.timeoutOrElse({
      duration: 5000,
      orElse: () => Effect.die(new Error("Condition was not reached")),
    }),
    Effect.orDie,
  );

const PINNED_SEED_ZERO = [0.6711372530266764, 0.7258461452833667];

const PINNED_FIRST_RANDOM = 0.34227450605335275;

const deterministicSupport = {
  BACKENDS,
  BUDGET,
  PINNED_FIRST_RANDOM,
  PINNED_SEED_ZERO,
  STARTED_AT,
  remoteDelayingFirst,
  start,
  waitFor,
};

export default deterministicSupport;
