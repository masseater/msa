import { Context } from "effect";

import type decideTypes from "./decide.types.ts";

export default class Decide extends Context.Service<Decide, decideTypes.DecideShape>()(
  "@msa/coding-agent/core/decision/decide-service/Decide",
) {}
