import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import InteractiveMode from "../src/modes/interactive/interactive-mode.ts";

type FakeUi = {
  start: () => void;
  stop: () => void;
  requestRender: (force?: boolean) => void;
};

type HandleCtrlZThis = {
  ui: FakeUi;
};

type ProcessSignalHandler = () => void;

type InteractiveModePrototypeWithHandleCtrlZ = {
  handleCtrlZ(this: HandleCtrlZThis): void;
};

function callHandleCtrlZ(context: HandleCtrlZThis): void {
  (interactiveModePrototype as InteractiveModePrototypeWithHandleCtrlZ).handleCtrlZ.call(context);
}

const interactiveModePrototype = InteractiveMode.prototype as unknown;

describe("InteractiveMode.handleCtrlZ", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("shows a status message and skips suspend on Windows", () => {
    const ui: FakeUi = {
      requestRender: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const showStatus = vi.fn();
    const context: HandleCtrlZThis & { showStatus: (message: string) => void } = { showStatus, ui };
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const processOnSpy = vi.spyOn(process, "on");
    const processOnceSpy = vi.spyOn(process, "once");
    const processKillSpy = vi.spyOn(process, "kill");

    try {
      callHandleCtrlZ(context);
    } finally {
      if (platformDescriptor !== undefined) {
        Object.defineProperty(process, "platform", platformDescriptor);
      }
    }

    expect(showStatus).toHaveBeenCalledWith("Suspend to background is not supported on Windows");
    expect(ui.stop).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(processOnSpy).not.toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(processOnceSpy).not.toHaveBeenCalledWith("SIGCONT", expect.any(Function));
    expect(processKillSpy).not.toHaveBeenCalled();
  });
});

const partPart1 = () => {
  const ui: FakeUi = {
    requestRender: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const context: HandleCtrlZThis = { ui };
  return { context, ui };
};

const captureSignalHandlers = () => {
  const handlers: { sigcont?: ProcessSignalHandler; sigint?: ProcessSignalHandler } = {};
  const processOnSpy = vi.spyOn(process, "on").mockImplementation(((
    event: string,
    listener: () => void,
  ) => {
    if (event === "SIGINT") handlers.sigint = listener;
    return process;
  }) as typeof process.on);
  const processOnceSpy = vi.spyOn(process, "once").mockImplementation(((
    event: string,
    listener: () => void,
  ) => {
    if (event === "SIGCONT") handlers.sigcont = listener;
    return process;
  }) as typeof process.once);
  return { handlers, processOnSpy, processOnceSpy };
};

const partPart2 = (input: { readonly context: HandleCtrlZThis; readonly ui: FakeUi }) => {
  const { context, ui } = input;

  vi.useFakeTimers();
  const { handlers, processOnSpy, processOnceSpy } = captureSignalHandlers();
  const removeListenerSpy = vi
    .spyOn(process, "removeListener")
    .mockImplementation(
      ((_event: string, _listener: () => void) => process) as typeof process.removeListener,
    );
  const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

  callHandleCtrlZ(context);

  expect(vi.getTimerCount()).toBe(1);
  expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  expect(processOnceSpy).toHaveBeenCalledWith("SIGCONT", expect.any(Function));
  expect(ui.stop).toHaveBeenCalledTimes(1);
  expect(processKillSpy).toHaveBeenCalledWith(0, "SIGTSTP");
  expect(handlers.sigint).toBeDefined();
  expect(handlers.sigcont).toBeDefined();

  handlers.sigcont?.();

  expect(vi.getTimerCount()).toBe(0);
  expect(removeListenerSpy).toHaveBeenCalledWith("SIGINT", handlers.sigint);
};

describe("InteractiveMode.handleCtrlZ", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("keeps the process alive while suspended and restores the TUI on SIGCONT", () => {
    const { context, ui } = partPart1();

    partPart2({ context, ui });
    expect(ui.start).toHaveBeenCalledTimes(1);
    expect(ui.requestRender).toHaveBeenCalledWith(true);
  });
});

describe("InteractiveMode.handleCtrlZ", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("cleans up the temporary handlers if suspension fails", () => {
    const ui: FakeUi = {
      requestRender: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const context: HandleCtrlZThis = { ui };
    const suspendError = new Error("suspend failed");

    vi.useFakeTimers();
    vi.spyOn(process, "on").mockImplementation(
      ((_event: string, _listener: () => void) => process) as typeof process.on,
    );
    const removeListenerSpy = vi
      .spyOn(process, "removeListener")
      .mockImplementation(
        ((_event: string, _listener: () => void) => process) as typeof process.removeListener,
      );
    vi.spyOn(process, "once").mockImplementation(
      ((_event: string, _listener: () => void) => process) as typeof process.once,
    );
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw suspendError;
    });

    expect(() => callHandleCtrlZ(context)).toThrow(suspendError);
    expect(ui.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListenerSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(ui.start).not.toHaveBeenCalled();
    expect(ui.requestRender).not.toHaveBeenCalled();
  });
});
