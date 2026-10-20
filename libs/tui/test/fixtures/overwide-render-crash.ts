import tuiModule from "../../src/index.ts";
import TestComponent from "../tui-render-test-component.ts";
import VirtualTerminal from "../virtual-terminal.ts";
const { TuiMainScreen } = tuiModule;

const logDirectory = process.argv[2];
const terminal = new VirtualTerminal(40, 10);
const tui = new TuiMainScreen(terminal, undefined, logDirectory === "" ? undefined : logDirectory);
const component = new TestComponent();
tui.addChild(component);
component.lines = ["ok"];
tui.start();
tui.renderNow();
component.lines = ["ok", "x".repeat(60)];
tui.renderNow();
