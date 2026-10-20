import { Type } from "typebox";

import { hostNamed, method, remote } from "../../src/index.ts";

const Echo = remote("t.echo", {
  host: hostNamed("w1"),
  input: Type.Object({}),
  variants: {
    main: {
      methods: {
        echo: method(Type.String(), Type.String()),
        pid: method(undefined, Type.Number()),
      },
    },
  },
  version: 1,
});

export default Echo;
