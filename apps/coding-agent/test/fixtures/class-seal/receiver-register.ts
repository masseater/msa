import ext from "../class-seal-external/ext.ts";
import Local from "./local.ts";

ext.kit.register("Base", Local);

export default class X extends ext.kit.Base {}
