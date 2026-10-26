import testing from "@msa/testing";
import lockfile from "proper-lockfile";
import { vi } from "vite-plus/test";

const { deferredPromise } = testing;

const observeLockAttempts = () => {
  const lock = lockfile.lock;
  const refused = deferredPromise<void>();
  const spy = vi.spyOn(lockfile, "lock").mockImplementation((file, options) => {
    const attempt = lock(file, options);
    attempt.then(
      () => undefined,
      () => refused.resolve(undefined),
    );
    return attempt;
  });
  return { refused: refused.promise, spy };
};

const freezeLockRetries = (): void => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
};

const lockAttempts = { freezeLockRetries, observeLockAttempts };

export default lockAttempts;
