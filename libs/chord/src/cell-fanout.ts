import Fanout from "./fanout.ts";

let sequence = 0;
function nextSequence(): number {
  sequence += 1;
  return sequence;
}

const cellFanout = {
  Fanout,
  nextSequence,
};

export default cellFanout;
