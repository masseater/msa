import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";

const { awaited } = awaitingModule;

function* transact<T>(step: {
  readonly checkpoint?: () => void;
  readonly fn: (current: string | undefined) => Promise<authStorageTypes.LockResult<T>>;
  readonly read: () => string | undefined | Promise<string | undefined>;
  readonly signal: AbortSignal | undefined;
  readonly write: (next: string) => void | Promise<void>;
}) {
  step.checkpoint?.();
  step.signal?.throwIfAborted();
  const current = yield* awaited(step.read());
  const { result, next } = yield* awaited(step.fn(current));
  step.checkpoint?.();
  step.signal?.throwIfAborted();
  if (next !== undefined) yield* awaited(step.write(next));
  step.checkpoint?.();
  return result;
}

const authStorageTransaction = { transact };

export default authStorageTransaction;
