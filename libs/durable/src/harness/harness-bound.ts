import type { Context } from "@msa/chord";
import { withAbortSignal } from "@msa/chord/context";
import { Clock, Effect, Function } from "effect";

import { promiseTry } from "../promise-try.ts";
import { contained } from "../session/session.ts";
import type { InvocationBinding, TaskScheduler } from "./scheduler.ts";
import type { Submissions } from "./submissions.ts";
import type { ConversationHandle, ConversationId } from "./types.ts";

const clockNow = (): number => Effect.runSync(Clock.currentTimeMillis);

export const safeReport =
  (onReport: ((error: unknown) => void) | undefined) =>
  (error: unknown): void =>
    contained(
      () => onReport?.(error),
      () => {},
    );

export const safeNow: {
  (report: (error: unknown) => void): (now: (() => number) | undefined) => () => number;
  (now: (() => number) | undefined, report: (error: unknown) => void): () => number;
} = Function.dual(
  2,
  (now: (() => number) | undefined, report: (error: unknown) => void): (() => number) => {
    if (now === undefined) return clockNow;
    let reported = false;
    return () => {
      try {
        return now();
      } catch (error) {
        if (!reported) {
          reported = true;
          report(error);
        }
        return clockNow();
      }
    };
  },
);

export const boundConversation: {
  (
    binding: InvocationBinding,
    submissions: Submissions,
    tasks: TaskScheduler,
  ): (id: ConversationId) => ConversationHandle;
  (
    id: ConversationId,
    binding: InvocationBinding,
    submissions: Submissions,
    tasks: TaskScheduler,
  ): ConversationHandle;
} = Function.dual(
  4,
  (
    id: ConversationId,
    binding: InvocationBinding,
    submissions: Submissions,
    tasks: TaskScheduler,
  ): ConversationHandle => {
    const bind = (context: Context): Context => withAbortSignal(binding.signal, context);
    const bound =
      <T>(operation: (context: Context) => Promise<T>) =>
      (context: Context): Promise<T> =>
        promiseTry(() => {
          binding.check();
          return operation(bind(context));
        });
    return {
      id,
      submit: (draft, context) =>
        promiseTry(() => {
          binding.check();
          return submissions.submit(id, draft, bind(context));
        }).then((submission) => ({
          id: submission.id,
          status: bound((callContext) => submission.status(callContext)),
          wait: bound((callContext) => submission.wait(callContext)),
          abort: bound((callContext) => submission.abort(callContext)),
        })),
      abort: (context, options) =>
        promiseTry(() => {
          binding.check();
          return tasks.abortConversation(id, options?.background === true, bind(context));
        }),
      waitForIdle: bound((callContext) => tasks.waitForIdle(id, callContext)),
    };
  },
);
