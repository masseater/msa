import trackerEmitDense from "./tracker-emit-dense.ts";
import trackerEmit from "./tracker-emit.ts";

const trackerEmitArrayKit = {
  get trackerEmit() {
    return trackerEmit;
  },
  get trackerEmitDense() {
    return trackerEmitDense;
  },
};

export default trackerEmitArrayKit;
