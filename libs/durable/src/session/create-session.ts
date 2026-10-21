import { Function } from "effect";

import type typesModule from "../types.types.ts";
import SessionImpl from "./session.ts";

type SessionOptions = { readonly now?: () => number; readonly documentRetentionMs?: number };

const isStorage = (value: unknown): value is typesModule.Storage =>
  typeof (value as { readonly commit?: unknown } | undefined)?.commit === "function";

const createSession: {
  (options?: SessionOptions): (storage: typesModule.Storage) => typesModule.Session;
  (storage: typesModule.Storage, options?: SessionOptions): typesModule.Session;
} = Function.dual(
  (args: IArguments) => isStorage(args[0]),
  (storage: typesModule.Storage, options?: SessionOptions): typesModule.Session => {
    const retention = options?.documentRetentionMs;
    return new SessionImpl(
      storage,
      options?.now,
      retention === undefined ? undefined : () => retention,
    );
  },
);

const createSessionModule = {
  createSession,
};

export default createSessionModule;
