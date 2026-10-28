import ext from "../class-seal-external/ext.ts";
import Local from "./local.ts";

export default class X extends (ext.subclassOf(Local) as typeof Local) {}
