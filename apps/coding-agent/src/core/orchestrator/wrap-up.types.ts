import type { Deferred } from "effect";

declare namespace wrapUpTypes {
  interface WrapUp {
    sent: boolean;
    memo: Deferred.Deferred<string, string>;
  }

  interface WrapUpResume {
    turn: () => void;
    settle: (error: unknown) => void;
  }
}

export type { wrapUpTypes as default };
