import type typesModule from "./types.types.ts";

const ABORT_SIGNAL_CONTEXT_KEY: typesModule.ContextKey<AbortSignal | undefined> = Object.freeze({
  token: Symbol("chord.abortSignal"),
});

const types = {
  ABORT_SIGNAL_CONTEXT_KEY,
};

export default types;
