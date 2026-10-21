import Box from "../components/box.ts";
import HStack from "../components/h-stack.ts";
import MouseRegion from "../components/mouse-region.ts";
import ScrollView from "../components/scroll-view.ts";
import Spacer from "../components/spacer.ts";
import splitPane from "../components/split-pane.ts";
import VStack from "../components/v-stack.ts";

const layoutKit: {
  readonly Box: typeof Box;
  readonly HStack: typeof HStack;
  readonly MouseRegion: typeof MouseRegion;
  readonly ScrollView: typeof ScrollView;
  readonly Spacer: typeof Spacer;
  readonly VStack: typeof VStack;
  readonly splitPane: typeof splitPane;
} = {
  Box,
  HStack,
  MouseRegion,
  ScrollView,
  Spacer,
  VStack,
  splitPane,
};

export default layoutKit;
