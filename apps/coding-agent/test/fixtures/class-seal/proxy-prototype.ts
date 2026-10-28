import type tui from "@msa/tui";

import Local from "./local.ts";

function Fake(): void {}

const Faked = new Proxy(Fake as unknown as typeof tui.Container, {
  get: (target, key) => (key === "prototype" ? Local.prototype : Reflect.get(target, key)),
});

export default class X extends Faked {}
