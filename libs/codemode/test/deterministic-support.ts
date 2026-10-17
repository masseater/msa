import { Effect, Schedule } from "effect";
import { dual } from "effect/Function";

import {
  type CodemodeHostCall,
  type CodemodeOutcome,
  type CodemodeRemoteExchange,
  type CodemodeRun,
  type CodemodeRunOptions,
  CodemodeSandbox,
  type CodemodeSandboxBase,
  type CodemodeSandboxBaseOptions,
  loadQuickJSWasm,
  RemoteCodemodeSandbox,
  serveCodemodeRemote,
} from "../src/index.ts";

export const BUDGET = 50_000;

function makeRemote(
  options: CodemodeSandboxBaseOptions,
  delayFirst: boolean,
): RemoteCodemodeSandbox {
  return new RemoteCodemodeSandbox({
    ...options,
    remote: () => ({
      execute: (request, exchange) => {
        const wrapped: CodemodeRemoteExchange = (messages) =>
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
          wasm: loadQuickJSWasm(),
          maxInterruptBudget: BUDGET,
        });
      },
    }),
  });
}

export function remoteDelayingFirst(options: CodemodeSandboxBaseOptions): RemoteCodemodeSandbox {
  return makeRemote(options, true);
}

export type Create = (options?: CodemodeSandboxBaseOptions) => CodemodeSandboxBase;

export const BACKENDS: Record<string, Create> = {
  worker: (options = {}) => new CodemodeSandbox(options),
  remote: (options = {}) => makeRemote(options, false),
};

export const STARTED_AT = Date.UTC(2026, 0, 15, 10, 0, 0);

export type Recorded = {
  run: CodemodeRun;
  calls: CodemodeHostCall[];
  idles: [seq: number, issued: number][];
  events: string[];
  fingerprint: () => string | undefined;
};

export type StartOptions = Partial<CodemodeRunOptions> & {
  answer?: (call: CodemodeHostCall) => CodemodeOutcome;
};

function startRecorded(
  sandbox: CodemodeSandboxBase,
  code: string,
  options: StartOptions = {},
): Recorded {
  const calls: CodemodeHostCall[] = [];
  const idles: [number, number][] = [];
  const events: string[] = [];
  let fingerprint: string | undefined;
  let seq = 0;
  const answer = options.answer ?? ((call: CodemodeHostCall) => ({ ok: true, value: call.args }));
  const run: CodemodeRun = sandbox.start(code, {
    startedAt: STARTED_AT,
    seed: 1,
    tools: [{ name: "echo" }, { name: "wait" }],
    timeoutMs: 20_000,
    ...options,
    onStarted: (value) => {
      fingerprint = value;
      events.push("started");
    },
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
  });
  return { run, calls, idles, events, fingerprint: () => fingerprint };
}

export const start: {
  (code: string, options?: StartOptions): (sandbox: CodemodeSandboxBase) => Recorded;
  (sandbox: CodemodeSandboxBase, code: string, options?: StartOptions): Recorded;
} = dual((args) => typeof args[0] !== "string", startRecorded);

const conditionReached = (check: () => boolean): Effect.Effect<void, string> =>
  Effect.suspend(() => (check() ? Effect.void : Effect.fail("not yet")));

export const waitFor = (check: () => boolean): Effect.Effect<void> =>
  conditionReached(check).pipe(
    Effect.retry(Schedule.spaced(5)),
    Effect.timeoutOrElse({
      duration: 5000,
      orElse: () => Effect.die(new Error("Condition was not reached")),
    }),
    Effect.orDie,
  );

export const PINNED_SEED_ZERO = [0.6711372530266764, 0.7258461452833667];

export const PINNED_FIRST_RANDOM = 0.34227450605335275;
