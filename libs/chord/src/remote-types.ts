import type { Effect } from "effect";

import type deltaTypes from "./delta/index.types.ts";
import type remoteTypesModule2 from "./remote.types.ts";
import type typesModule from "./types.types.ts";
import type wireTypes from "./wire.types.ts";

declare namespace remoteTypesModule {
  interface StateIn {
    readonly as: "snap" | "reset" | "ops" | "error";
    readonly value?: unknown;
    readonly ops?: readonly unknown[];
    readonly error?: wireTypes.WireError;
  }

  interface RemoteCall {
    readonly hold: number;
    readonly member: string;
    readonly args: unknown;
    readonly root: wireTypes.RootRef | undefined;
    readonly signal: AbortSignal;
  }

  interface RemoteChannel {
    hold(binding: remoteTypesModule2.RemoteBinding, again: boolean): number;
    release(id: number): void;
    call(request: RemoteCall): Effect.Effect<unknown>;
    wantState(hold: number, wanted: boolean): void;
  }

  interface RemoteHost {
    readonly inFactory: number;
    report(error: unknown): void;
    root<T>(
      fn: (ctx: typesModule.Ctx) => T | Promise<T>,
      options?: { signal?: AbortSignal | undefined },
    ): Promise<T>;
    bindingIdle(binding: remoteTypesModule2.RemoteBinding): void;
    forgetBinding(binding: remoteTypesModule2.RemoteBinding): void;
  }

  interface MemberState {
    value: unknown;
    decoder: deltaTypes.Decoder;
  }

  interface Settle {
    resolve: () => void;
    reject: (error: unknown) => void;
  }
}

export type { remoteTypesModule as default };
