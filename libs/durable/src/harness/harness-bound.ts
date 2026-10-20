import contextModule from "@msa/chord/context";
import type chordTypes from "@msa/chord/index.types";
import { Function } from "effect";

import clockModule from "../clock.ts";
import promiseTryModule from "../promise-try.ts";
import sessionState from "../session/session-state.ts";
import type schedulerTypes from "./scheduler.types.ts";
import type submissionsTypes from "./submissions.types.ts";
import type typesModule from "./types.types.ts";

const { withAbortSignal } = contextModule;

const { currentTimeMillis } = clockModule;
const { contained } = sessionState;
const { promiseTry } = promiseTryModule;

const clockNow = currentTimeMillis;

const safeReport =
  (onReport: ((error: unknown) => void) | undefined) =>
  (error: unknown): void =>
    contained(
      () => onReport?.(error),
      () => {},
    );

const safeNow: {
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

const boundConversation: {
  (
    binding: schedulerTypes.InvocationBinding,
    submissions: submissionsTypes.Submissions,
    tasks: schedulerTypes.TaskScheduler,
  ): (id: typesModule.ConversationId) => typesModule.ConversationHandle;
  (
    id: typesModule.ConversationId,
    binding: schedulerTypes.InvocationBinding,
    submissions: submissionsTypes.Submissions,
    tasks: schedulerTypes.TaskScheduler,
  ): typesModule.ConversationHandle;
} = Function.dual(
  4,
  (
    id: typesModule.ConversationId,
    binding: schedulerTypes.InvocationBinding,
    submissions: submissionsTypes.Submissions,
    tasks: schedulerTypes.TaskScheduler,
  ): typesModule.ConversationHandle => {
    const bind = (context: chordTypes.Context): chordTypes.Context =>
      withAbortSignal(binding.signal, context);
    const bound =
      <T>(operation: (context: chordTypes.Context) => Promise<T>) =>
      (context: chordTypes.Context): Promise<T> =>
        promiseTry(() => {
          binding.check();
          return operation(bind(context));
        });
    return {
      abort: (context, options) =>
        promiseTry(() => {
          binding.check();
          return tasks.abortConversation(id, options?.background === true, bind(context));
        }),
      id,
      submit: (draft, context) =>
        promiseTry(() => {
          binding.check();
          return submissions.submit(id, draft, bind(context));
        }).then((submission) => ({
          abort: bound((callContext) => submission.abort(callContext)),
          id: submission.id,
          status: bound((callContext) => submission.status(callContext)),
          wait: bound((callContext) => submission.wait(callContext)),
        })),
      waitForIdle: bound((callContext) => tasks.waitForIdle(id, callContext)),
    };
  },
);

const harnessBound = {
  boundConversation,
  safeNow,
  safeReport,
};

export default harnessBound;
