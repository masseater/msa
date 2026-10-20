import { Effect } from "effect";

import CtxImpl from "./ctx.ts";
import type ctxTypes from "./ctx.types.ts";
import errorsModule from "./errors.ts";
import ResolvedMethod from "./method.ts";
import type objectTypes from "./object.types.ts";
import type refTypes from "./ref.types.ts";
import signalModule from "./signal.ts";
import type typesModule from "./types.types.ts";

const { raceSignal } = signalModule;
const { ChordError, invalid } = errorsModule;

export default class ObjectCalls {
  readonly #object: objectTypes.ObjectImpl;

  constructor(object: objectTypes.ObjectImpl) {
    this.#object = object;
  }

  run(ref: refTypes.RefImpl, name: string, args: unknown, ctx: ctxTypes.CtxImpl): Promise<unknown> {
    return Effect.runPromise(this.call(ref, name, args, ctx));
  }

  call(
    ref: refTypes.RefImpl,
    name: string,
    args: unknown,
    ctx: ctxTypes.CtxImpl,
  ): Effect.Effect<unknown> {
    return Effect.gen({ self: this }, function* () {
      const object = this.#object;
      ctx.check(object.host);
      if (ref.status === "released" || ref.status === "gone") throw ref.terminalError();
      if (ref.status === "loading")
        yield* raceSignal(
          Effect.promise(() => ref.ready),
          ctx.signal,
        );
      if (ref.status !== "live" || object.status !== "live") {
        throw ref.status === "live"
          ? new ChordError("gone", `${object.address} is ${object.status}`)
          : ref.terminalError();
      }
      this.admit(ctx);
      const method = new ResolvedMethod(object, ref, name, ctx);
      const input = method.takesArgs ? method.input(args) : undefined;
      this.lease(ctx);
      const child = ctx.child(object);
      const result = yield* Effect.promise(() =>
        this.invoke(() =>
          method.takesArgs
            ? (method.fn as (args: unknown, ctx: typesModule.Ctx) => unknown)(input, child)
            : (method.fn as (ctx: typesModule.Ctx) => unknown)(child),
        ),
      ).pipe(Effect.ensuring(Effect.sync(() => child.close())));
      return method.result(result);
    });
  }

  admit(ctx: typesModule.Ctx): void {
    const object = this.#object;
    if (object.host.failed !== undefined) {
      throw new ChordError("unavailable", `${object.host.name} failed and admits no work`, {
        reason: "host_failed",
      });
    }
    if (!object.host.hasCodeVersion(ctx.codeVersion))
      throw new ChordError("superseded", `code version ${ctx.codeVersion} is retired`);
    if (ctx.codeVersion < object.minCodeVersion) {
      throw new ChordError(
        "upgrade_conflict",
        `${object.address} was upgraded in code version ${object.minCodeVersion}`,
      );
    }
    if (object.gate !== undefined && !object.gate.grandfathered.has(ctx.rootId)) {
      throw new ChordError("upgrade_conflict", `${object.address} is being upgraded`);
    }
  }

  lease(ctx: typesModule.Ctx): void {
    const object = this.#object;
    if (object.leases.has(ctx.rootId)) return;
    object.leases.set(ctx.rootId, ctx.codeVersion);
    object.host.touch(ctx.rootId, object);
  }

  readonly guard = (ctx: typesModule.Ctx): void => {
    const object = this.#object;
    if (object.host.inFactory > 0)
      throw invalid("read_only", "cells cannot be written while a factory runs");
    if (ctx instanceof CtxImpl) ctx.check(object.host);
    if (ctx.signal.aborted) throw new ChordError("aborted", "write with an aborted ctx");
    if (object.status === "disposed") throw new ChordError("gone", `${object.address} is disposed`);
    if (ctx.rootId.startsWith("task:")) return;
    this.admit(ctx);
  };

  invoke<T>(fn: () => T | Promise<T>): Promise<T> {
    const object = this.#object;
    const invocation = Effect.runPromise(Effect.promise(() => Promise.resolve(fn())));
    object.invocations.add(invocation);
    const settle = (): void => {
      object.invocations.delete(invocation);
      if (object.invocations.size === 0) object.maybeIdle();
    };
    invocation.then(settle, settle);
    return invocation;
  }
}
