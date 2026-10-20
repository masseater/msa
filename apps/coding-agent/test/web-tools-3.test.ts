import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import externalServices from "../src/core/external-services.ts";
import processEnv from "../src/core/process-env.ts";
import tregModule from "../src/core/treg.ts";
import webToolsSupport from "./web-tools-support.ts";

const { EXTERNAL_SERVICES, findExternalService } = externalServices;
const { loginTreg, logoutTreg } = tregModule;
const { readEnv } = processEnv;

const { fakeTreg } = webToolsSupport;

const {
  abortController,
  awaited,
  changeMode,
  joinPath,
  makeTempDir,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let bin3: string;

const script = Effect.fn("script")(function* (name: string, body: string) {
  const path = joinPath(bin3, name);
  yield* writeTextFile(path, `#!/bin/sh\n${body}\n`);
  yield* changeMode(path, 0o755);
  return path;
});

const treg = () => findExternalService(EXTERNAL_SERVICES, "TREG")!;

const showsThePageAndCodeTregLogin = () =>
  runTest(
    Effect.gen(function* () {
      const command = yield* script(
        "treg",
        [
          `echo "Opening your browser to sign in…"`,
          `echo "If it doesn't open, visit:"`,
          `echo "  https://treg.to/login?cli=abc#code=8HPQ"`,
          `echo "  The sign-in page shows this code — check it matches:  8HPQ"`,
          `echo "Waiting for authorization…"`,
          `echo "Signed in as you@example.com"`,
        ].join("\n"),
      );
      const onPage = vi.fn();
      yield* awaited(loginTreg(command, onPage));
      expect(onPage).toHaveBeenCalledExactlyOnceWith({
        code: "8HPQ",
        url: "https://treg.to/login?cli=abc#code=8HPQ",
      });
    }),
  );

const reportsWhyTregLoginFailed = () =>
  runTest(
    Effect.gen(function* () {
      const command = yield* script(
        "treg",
        `echo "Waiting for authorization…"\necho "Sign-in expired" >&2\nexit 1`,
      );
      yield* awaited(
        expect(loginTreg(command, () => {})).rejects.toThrow("treg login failed: Sign-in expired"),
      );
    }),
  );

const stopsTregLoginWhenTheDialogIs = () =>
  runTest(
    Effect.gen(function* () {
      const command = yield* script("treg", "sleep 60");
      const controller = abortController();
      const pending = loginTreg(command, () => {}, controller.signal);
      controller.abort();
      yield* awaited(expect(pending).rejects.toThrow());
    }),
  );

const reportsWhyTregLogoutFailed = () =>
  runTest(
    Effect.gen(function* () {
      const command = yield* script("treg", `echo "no login" >&2\nexit 2`);
      yield* awaited(expect(logoutTreg(command)).rejects.toThrow("treg logout failed: no login"));
    }),
  );

const tellsLoginHowToInstallTregWhen = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("PATH", bin3);
      expect(yield* awaited(treg().status())).toEqual({
        install: "curl -fsSL https://treg.to/install.sh | sh",
        installed: false,
      });
      expect(treg().tools?.()).toEqual([]);
    }),
  );

const reportsWhetherTregIsSignedInAnd = () =>
  runTest(
    Effect.gen(function* () {
      yield* fakeTreg(bin3, true);
      vi.stubEnv("PATH", `${bin3}:${readEnv("PATH")}`);
      expect(yield* awaited(treg().status())).toEqual({ installed: true, signedIn: true });
      expect(
        treg()
          .tools?.()
          .map((tool) => tool.name),
      ).toEqual(["web_search", "web_fetch"]);
    }),
  );

const beforeEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      bin3 = yield* makeTempDir("msa-treg-login-");
    }),
  );

const afterEachHook = () =>
  runTest(
    Effect.gen(function* () {
      vi.unstubAllEnvs();
      yield* removePath(bin3);
    }),
  );

describe("treg sign-in", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook);

  it(
    "shows the page and code treg login prints, and finishes when it does",
    showsThePageAndCodeTregLogin,
  );

  it("reports why treg login failed", reportsWhyTregLoginFailed);

  it("stops treg login when the dialog is cancelled", stopsTregLoginWhenTheDialogIs);

  it("reports why treg logout failed", reportsWhyTregLogoutFailed);

  it("tells /login how to install treg when it is missing", tellsLoginHowToInstallTregWhen);

  it(
    "reports whether treg is signed in and brings the web tools once it is",
    reportsWhetherTregIsSignedInAnd,
  );
});
