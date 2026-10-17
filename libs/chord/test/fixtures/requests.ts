import { Effect } from "effect";
import { Type } from "typebox";

import { pollUntil } from "./timing.ts";

export const until = (check: () => boolean, attempts = 100) =>
  pollUntil(check, attempts, Effect.sleep(2));

export const View = Type.Object({ text: Type.String() });
