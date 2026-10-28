import Local from "./local.ts";

const written = Reflect.setPrototypeOf(Function.prototype, Local.prototype);

class P {}

export default { local: Local, subject: P, written };
