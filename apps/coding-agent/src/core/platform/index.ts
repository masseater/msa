import * as NodeServices from "@effect/platform-node/NodeServices";
import { Clock, Effect, ManagedRuntime, Path, Predicate } from "effect";

export const platformRuntime = ManagedRuntime.make(NodeServices.layer);

export interface PathOperations {
  readonly join: (...segments: ReadonlyArray<string>) => string;
  readonly resolve: (...segments: ReadonlyArray<string>) => string;
  readonly dirname: (path: string) => string;
  readonly basename: (path: string, suffix?: string) => string;
  readonly extname: (path: string) => string;
  readonly relative: (from: string, to: string) => string;
  readonly isAbsolute: (path: string) => boolean;
  readonly normalize: (path: string) => string;
  readonly sep: string;
}

const servicePath = platformRuntime.runSync(Path.Path);

export const pathOperations: PathOperations = {
  join: (...segments) => servicePath.join(...segments),
  resolve: (...segments) => servicePath.resolve(...segments),
  dirname: (path) => servicePath.dirname(path),
  basename: (path, suffix) => servicePath.basename(path, suffix),
  extname: (path) => servicePath.extname(path),
  relative: (from, to) => servicePath.relative(from, to),
  isAbsolute: (path) => servicePath.isAbsolute(path),
  normalize: (path) => servicePath.normalize(path),
  sep: servicePath.sep,
};

export const currentTimeMillis = (): number => platformRuntime.runSync(Clock.currentTimeMillis);

export const abortedBy =
  (signal: AbortSignal | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    signal === undefined
      ? effect
      : Effect.raceFirst(
          effect,
          Effect.callback<never>((resume, abortSignal) => {
            const fail = (): void => resume(Effect.die(new Error("Operation aborted")));
            if (signal.aborted) fail();
            else signal.addEventListener("abort", fail, { once: true, signal: abortSignal });
          }),
        );

export const isMissingPath = (error: unknown): boolean => {
  if (!Predicate.hasProperty(error, "reason")) return false;
  const { reason } = error;
  if (Predicate.isTagged(reason, "NotFound")) return true;
  const cause = Predicate.hasProperty(reason, "cause") ? reason.cause : undefined;
  return (
    Predicate.hasProperty(cause, "code") && (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  );
};

export const rethrowCause = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.die(
        Predicate.hasProperty(error, "cause") && error.cause !== undefined ? error.cause : error,
      ),
    ),
  );
