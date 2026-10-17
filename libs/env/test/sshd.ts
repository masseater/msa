import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, Socket } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterAll, beforeAll } from "vite-plus/test";

import { acceptHostKey, connectSsh, scanHostKey, type SshTarget } from "../src/ssh.ts";
import { daemon } from "./daemon.ts";

export const deployedName = `msa-env-${createHash("sha256").update(readFileSync(daemon)).digest("hex").slice(0, 32)}`;

function which(program: string): string | undefined {
  try {
    const found = execFileSync("sh", ["-c", `command -v ${program}`], { encoding: "utf8" }).trim();
    return found === "" ? undefined : found;
  } catch {
    return undefined;
  }
}

export const sshd =
  process.platform === "win32"
    ? undefined
    : (which("sshd") ?? (existsSync("/usr/sbin/sshd") ? "/usr/sbin/sshd" : undefined));

export const posixAccountShell = /(?:^|\/)(?:sh|bash|dash|ksh|zsh)$/u.test(userInfo().shell ?? "");

export const keygen = (file: string): void => {
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", file]);
};

export const publicKey = (file: string): string =>
  readFileSync(`${file}.pub`, "utf8").split(" ").slice(0, 2).join(" ");

const freePort = Effect.callback<number>((resume) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const { port } = server.address() as { port: number };
    server.close(() => {
      resume(Effect.succeed(port));
    });
  });
});

const portOpen = (port: number): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    const socket = new Socket();
    socket
      .once("connect", () => {
        resume(Effect.succeed(true));
      })
      .once("error", () => {
        resume(Effect.succeed(false));
      });
    socket.connect(port, "127.0.0.1");
  });

const waitForPort = (port: number): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (yield* portOpen(port)) return;
      yield* Effect.sleep(50);
    }
    return yield* Effect.die(new Error("sshd did not start"));
  });

export interface SshServer {
  readonly root: string;
  readonly home: string;
  readonly target: SshTarget;
  readonly hostFingerprint: string;
}

const sshdConfig = (root: string, home: string, port: number): string =>
  [
    `Port ${port}`,
    "ListenAddress 127.0.0.1",
    `HostKey ${join(root, "host_key")}`,
    `AuthorizedKeysFile ${join(root, "authorized_keys")}`,
    `PidFile ${join(root, "sshd.pid")}`,
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "StrictModes no",
    `SetEnv HOME=${home}`,
    "",
  ].join("\n");

interface Running {
  child?: ChildProcess;
  server?: SshServer;
}

const startServer = (root: string, running: Running): Effect.Effect<void> =>
  Effect.gen(function* () {
    const home = join(root, "home");
    execFileSync("mkdir", ["-p", home]);
    keygen(join(root, "host_key"));
    keygen(join(root, "client_key"));
    writeFileSync(join(root, "authorized_keys"), readFileSync(join(root, "client_key.pub")));
    const port = yield* freePort;
    writeFileSync(join(root, "sshd_config"), sshdConfig(root, home, port));
    writeFileSync(join(root, "ssh_config"), "");
    running.child = spawn(sshd!, ["-D", "-e", "-f", join(root, "sshd_config")], {
      stdio: "ignore",
    });
    yield* waitForPort(port);
    const hostFingerprint = execFileSync("ssh-keygen", ["-lf", join(root, "host_key.pub")], {
      encoding: "utf8",
    }).split(" ")[1]!;
    const target: SshTarget = {
      host: "127.0.0.1",
      port,
      user: userInfo().username,
      identityFile: join(root, "client_key"),
      knownHostsFile: join(root, "known_hosts"),
      hostKeyAlias: "msa-env-test",
      configFile: join(root, "ssh_config"),
    };
    running.server = { root, home, target, hostFingerprint };
  });

const trust = (running: Running): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { target } = running.server!;
    const scanned = yield* Effect.promise(() => scanHostKey(target));
    yield* Effect.promise(() => acceptHostKey(target, scanned.lines));
  });

export function useSshd(trusted: boolean): () => SshServer {
  const root = mkdtempSync(join(tmpdir(), "msa-env-ssh-"));
  const running: Running = {};
  beforeAll(() =>
    Effect.runPromise(
      startServer(root, running).pipe(Effect.andThen(trusted ? trust(running) : Effect.void)),
    ),
  );
  afterAll(() => {
    running.child?.kill();
    rmSync(root, { recursive: true, force: true });
  });
  return () => running.server!;
}

export interface ConnectTo {
  readonly server: SshServer;
  readonly loginShell?: boolean;
}

export const connectTo = ({ server, loginShell }: ConnectTo): ReturnType<typeof connectSsh> =>
  connectSsh({
    ...server.target,
    binary: daemon,
    ...(loginShell === undefined ? {} : { loginShell }),
  });
