import { dual } from "effect/Function";

import mainPart16 from "./main-part16.ts";
import type mainTypes from "./main.types.ts";

const { mainImpl } = mainPart16;

const main: {
  (args: string[], options?: mainTypes.MainOptions): Promise<undefined>;
  (options?: mainTypes.MainOptions): (args: string[]) => Promise<undefined>;
} = dual((args: IArguments) => args.length >= 1, mainImpl);

const mainPart17 = {
  main,
};

export default mainPart17;
