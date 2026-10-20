import applyImmutableTrusted from "./apply-immutable-trusted.ts";
import apply from "./apply.ts";
import trackerGuards from "./tracker-guards.ts";
import trackerTypes from "./tracker-types.ts";

const trackerContextKit = {
  apply,
  applyImmutableTrusted,
  trackerGuards,
  trackerTypes,
};

export default trackerContextKit;
