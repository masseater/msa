import { Type } from "typebox";

import chord from "../../src/index.ts";

const { hostNamed, method, remote } = chord;

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
