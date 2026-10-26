import Local from "./local.ts";

const F = function (): void {};
Object.setPrototypeOf(F, Local);

export default class X extends (F as unknown as typeof Local) {}
