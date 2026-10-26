import extend from "./extend.ts";

class Outer {
  static readonly Inner = extend.subclass(Outer);
}

export default { local: Outer, subject: Outer.Inner };
