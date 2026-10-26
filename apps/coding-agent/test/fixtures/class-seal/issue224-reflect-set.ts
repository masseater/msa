import tui from "@msa/tui";

import Local from "./local.ts";

const passthrough = <T>(value: T): T => value;
if (!Reflect.set(passthrough(tui), "Container", Local)) throw new TypeError("read-only");

export default class X extends tui.Container {}
