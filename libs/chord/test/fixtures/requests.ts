import { Effect } from "effect";
import { Type } from "typebox";

import timing from "./timing.ts";

const { pollUntil } = timing;

const until = pollUntil(100, Effect.sleep(2));

const View = Type.Object({ text: Type.String() });

const requests = {
  View,
  until,
};

export default requests;
