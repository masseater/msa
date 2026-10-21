import type boxTypes from "../components/box.types.ts";
import type hStackTypes from "../components/h-stack.types.ts";
import type mouseRegionTypes from "../components/mouse-region.types.ts";
import type scrollViewTypes from "../components/scroll-view.types.ts";
import type spacerTypes from "../components/spacer.types.ts";
import type splitPaneTypes from "../components/split-pane.types.ts";
import type stackTypes from "../components/stack.types.ts";
import type vStackTypes from "../components/v-stack.types.ts";

declare namespace tuiLayoutKitTypes {
  type MouseRegionHandler = mouseRegionTypes.MouseRegionHandler;
  type MouseRegion = mouseRegionTypes.MouseRegion;
  type ScrollViewOptions = scrollViewTypes.ScrollViewOptions;
  type ScrollViewScrollbar = scrollViewTypes.ScrollViewScrollbar;
  type ScrollViewScrollToOptions = scrollViewTypes.ScrollViewScrollToOptions;
  type SplitPaneOptions = splitPaneTypes.SplitPaneOptions;
  type SplitPaneWidths = splitPaneTypes.SplitPaneWidths;
  type StackChild = stackTypes.StackChild;
  type StackEntry = stackTypes.StackEntry;
  type StackEntryOptions = stackTypes.StackEntryOptions;
  type StackOptions = stackTypes.StackOptions;
  type ScrollView = scrollViewTypes.ScrollView;
  type SplitPane = splitPaneTypes.SplitPane;
  type Box = boxTypes.Box;
  type HStack = hStackTypes.HStack;
  type Spacer = spacerTypes.Spacer;
  type VStack = vStackTypes.VStack;
}

export type { tuiLayoutKitTypes as default };
