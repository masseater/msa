import type { Effect } from "effect";

import type { Decoder } from "./delta/index.ts";
import type { RemoteBinding } from "./remote.ts";
import type { Ctx } from "./types.ts";
import type { RootRef, WireError } from "./wire.ts";

export interface StateIn {
  readonly as: "snap" | "reset" | "ops" | "error";
  readonly value?: unknown;
  readonly ops?: readonly unknown[];
  readonly error?: WireError;
}

export interface RemoteCall {
  readonly hold: number;
  readonly member: string;
  readonly args: unknown;
  readonly root: RootRef | undefined;
  readonly signal: AbortSignal;
}

export interface RemoteChannel {
  hold(binding: RemoteBinding, again: boolean): number;
  release(id: number): void;
  call(request: RemoteCall): Effect.Effect<unknown>;
  wantState(hold: number, wanted: boolean): void;
}

export interface RemoteHost {
  readonly inFactory: number;
  report(error: unknown): void;
  root<T>(
    fn: (ctx: Ctx) => T | Promise<T>,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<T>;
  bindingIdle(binding: RemoteBinding): void;
  forgetBinding(binding: RemoteBinding): void;
}

export interface MemberState {
  value: unknown;
  decoder: Decoder;
}

export interface Settle {
  resolve: () => void;
  reject: (error: unknown) => void;
}
