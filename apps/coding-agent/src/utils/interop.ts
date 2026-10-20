import { Effect } from "effect";
import { dual } from "effect/Function";

const callbackPromise = <T>(
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

const fetchResponseImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
  Effect.runPromise(Effect.promise(() => currentFetch()(input, init)));

const fetchResponse: {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
  (init?: RequestInit): (input: string | URL | Request) => Promise<Response>;
} = dual((args: IArguments) => args.length >= 1, fetchResponseImpl);

const interop = {
  callbackPromise,
  fetchResponse,
};

export default interop;
