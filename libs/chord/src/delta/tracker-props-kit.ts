import trackerArrayPieces from "./tracker-array-pieces.ts";
import trackerArray from "./tracker-array.ts";

const trackerPropsKit = {
  get trackerArray() {
    return trackerArray;
  },
  get trackerArrayPieces() {
    return trackerArrayPieces;
  },
};

export default trackerPropsKit;
