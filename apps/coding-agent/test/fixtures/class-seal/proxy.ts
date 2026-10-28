import Local from "./local.ts";

export default class X extends (new Proxy(Local, {})) {}
