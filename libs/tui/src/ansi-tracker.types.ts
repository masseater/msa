import type ansiTracker from "./ansi-tracker.ts";

declare namespace ansiTrackerTypes {
  type AnsiCodeTracker = (typeof ansiTracker.AnsiCodeTracker)["prototype"];
}

export type { ansiTrackerTypes as default };
