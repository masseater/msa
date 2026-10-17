import { Effect } from "effect";
import { Type } from "typebox";

import { pollUntil } from "./timing.ts";

export const until = pollUntil(100, Effect.sleep(2));

export const View = Type.Object({ text: Type.String() });
