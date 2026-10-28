import Local from "./local.ts";

function F(): void {}
F.prototype = Local.prototype;

export default class X extends (F as unknown as typeof Local) {}
