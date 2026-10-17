import { Function } from "effect";

import type { Session, Storage } from "../types.ts";
import { SessionImpl } from "./session.ts";

type SessionOptions = { readonly now?: () => number; readonly documentRetentionMs?: number };

const isStorage = (value: unknown): value is Storage =>
  typeof (value as { readonly commit?: unknown } | undefined)?.commit === "function";

export const createSession: {
  (options?: SessionOptions): (storage: Storage) => Session;
  (storage: Storage, options?: SessionOptions): Session;
} = Function.dual(
  (args: IArguments) => isStorage(args[0]),
  (storage: Storage, options?: SessionOptions): Session => {
    const retention = options?.documentRetentionMs;
    return new SessionImpl(
      storage,
      options?.now,
      retention === undefined ? undefined : () => retention,
    );
  },
);
