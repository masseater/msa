import Local from "./local.ts";

const mixin = <T>(value: T): T => value;

export default class X extends mixin(Local) {}
