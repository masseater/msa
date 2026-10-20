import type chordTypes from "../../src/index.types.ts";
import type countingTypes from "./counting.types.ts";

const stateFrames = (frames: readonly chordTypes.Frame[]): countingTypes.StateFrame[] =>
  frames.filter((frame): frame is countingTypes.StateFrame => frame.t === "state");

const counting = {
  stateFrames,
};

export default counting;
