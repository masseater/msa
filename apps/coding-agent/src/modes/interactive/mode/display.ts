import type InteractiveMode from "../interactive-mode.ts";
import LoadedResourcesView from "./loaded-resources-view.ts";
import ModeNotices from "./notices-group.ts";
import OperationStatusEvents from "./operation-status.ts";
import StatusMessages from "./status-messages.ts";
import ModeTheme from "./theme.ts";
import ThinkingVisibility from "./thinking-visibility.ts";
import WorkingIndicator from "./working-indicator.ts";

export default class ModeDisplay {
  readonly operationStatus: OperationStatusEvents;
  readonly status: StatusMessages;
  readonly indicator: WorkingIndicator;
  readonly resources: LoadedResourcesView;
  readonly thinking: ThinkingVisibility;
  readonly theme: ModeTheme;
  readonly notices: ModeNotices;

  constructor(mode: InteractiveMode) {
    this.operationStatus = new OperationStatusEvents(mode);
    this.status = new StatusMessages(mode);
    this.indicator = new WorkingIndicator(mode);
    this.resources = new LoadedResourcesView(mode);
    this.thinking = new ThinkingVisibility(mode);
    this.theme = new ModeTheme(mode);
    this.notices = new ModeNotices(mode);
  }
}
