import { Effect } from "effect";

export const callbackPromise = <T>(
  register: (
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> =>
  Effect.runPromise(
    Effect.callback<T>((resume) => {
      register(
        (value) => resume(Effect.promise(() => Promise.resolve(value))),
        (reason) => resume(Effect.die(reason)),
      );
    }),
  );

const currentFetch = (): typeof globalThis.fetch => globalThis.fetch;

export const fetchResponse = (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => Effect.runPromise(Effect.promise(() => currentFetch()(input, init)));
