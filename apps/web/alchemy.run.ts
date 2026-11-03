import { providers, state } from "@alchemy.run/cloudflare";
import { Stack } from "alchemy";
import { Effect } from "effect";

import APP_NAME from "./app-name.ts";

export default Stack(APP_NAME, { providers: providers(), state: state() }, Effect.void);
