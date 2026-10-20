import indexKitPart1 from "./index-kit-part1.ts";
import indexKitPart2 from "./index-kit-part2.ts";
import indexKitPart3 from "./index-kit-part3.ts";
import indexKitPart4 from "./index-kit-part4.ts";

const components: typeof indexKitPart1 &
  typeof indexKitPart2 &
  typeof indexKitPart3 &
  typeof indexKitPart4 = {
  ...indexKitPart1,
  ...indexKitPart2,
  ...indexKitPart3,
  ...indexKitPart4,
};

export default components;
