import { Socket, createServer } from "node:net";
import { userInfo } from "node:os";

import { Effect } from "effect";
import { afterAll, beforeAll, inject } from "vite-plus/test";

import { Connection } from "../src/connection.ts";
import { type SshTarget, acceptHostKey, connectSsh, scanHostKey } from "../src/ssh.ts";
import daemon from "./daemon.ts";
import platformModule from "./platform.ts";
import type platformTypes from "./platform.types.ts";
import type sshdTypes from "./sshd.types.ts";

const {
  localPath,
  makeDirectory,
  makeTempDirectory,
  readText,
  removePath,
  runStatus,
  runText,
  startBackground,
  writeText,
} = platformModule;

const deployedName = inject("deployedName");

const sshdPath = inject("sshd");
const sshd = sshdPath === "" ? undefined : sshdPath;

const posixAccountShell = /(?:^|\/)(?:sh|bash|dash|ksh|zsh)$/u.test(userInfo().shell ?? "");

const keygen = (file: string): Effect.Effect<void> =>
  Effect.flatMap(runStatus(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", file]), (code) =>
    code === 0 ? Effect.void : Effect.die(new Error(`ssh-keygen failed with exit code ${code}`)),
  );

const publicKey = (file: string): Effect.Effect<string> =>
  Effect.map(readText(`${file}.pub`), (text) => text.split(" ").slice(0, 2).join(" "));

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

const sshdConfig = (root: string, home: string, port: number): string =>
  [
    `Port ${port}`,
    "ListenAddress 127.0.0.1",
    `HostKey ${localPath.join(root, "host_key")}`,
    `AuthorizedKeysFile ${localPath.join(root, "authorized_keys")}`,
    `PidFile ${localPath.join(root, "sshd.pid")}`,
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "StrictModes no",
    `SetEnv HOME=${home}`,
    "",
  ].join("\n");

interface Running {
  root?: string;
  child?: platformTypes.Background;
  server?: sshdTypes.SshServer;
}

const startServer = (running: Running): Effect.Effect<void> =>
  Effect.gen(function* () {
    const root = yield* makeTempDirectory("msa-env-ssh-");
    running.root = root;
    const home = localPath.join(root, "home");
    yield* makeDirectory(home);
    yield* keygen(localPath.join(root, "host_key"));
    yield* keygen(localPath.join(root, "client_key"));
    yield* writeText({
      path: localPath.join(root, "authorized_keys"),
      text: yield* readText(localPath.join(root, "client_key.pub")),
    });
    const port = yield* freePort;
    yield* writeText({
      path: localPath.join(root, "sshd_config"),
      text: sshdConfig(root, home, port),
    });
    yield* writeText({ path: localPath.join(root, "ssh_config"), text: "" });
    running.child = yield* startBackground([
      sshd!,
      "-D",
      "-e",
      "-f",
      localPath.join(root, "sshd_config"),
    ]);
    yield* waitForPort(port);
    const hostFingerprint = (yield* runText([
      "ssh-keygen",
      "-lf",
      localPath.join(root, "host_key.pub"),
    ])).split(" ")[1]!;
    const target: SshTarget = {
      configFile: localPath.join(root, "ssh_config"),
      host: "127.0.0.1",
      hostKeyAlias: "msa-env-test",
      identityFile: localPath.join(root, "client_key"),
      knownHostsFile: localPath.join(root, "known_hosts"),
      port,
      user: userInfo().username,
    };
    running.server = { home, hostFingerprint, root, target };
  });

const trust = (running: Running): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { target } = running.server!;
    const scanned = yield* Effect.promise(() => scanHostKey(target));
    yield* Effect.promise(() => acceptHostKey(target, scanned.lines));
  });

function useSshd(trusted: boolean): () => sshdTypes.SshServer {
  const running: Running = {};
  beforeAll(() =>
    Effect.runPromise(
      startServer(running).pipe(Effect.andThen(trusted ? trust(running) : Effect.void)),
    ),
  );
  afterAll(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        if (running.child !== undefined) yield* running.child.stop;
        if (running.root !== undefined) yield* removePath(running.root);
      }),
    ),
  );
  return () => running.server!;
}

const connectTo = ({ server, loginShell }: sshdTypes.ConnectTo): ReturnType<typeof connectSsh> =>
  connectSsh({
    ...server.target,
    binary: daemon,
    ...(loginShell === undefined ? {} : { loginShell }),
  });

const localConnection = (): Connection => new Connection({ command: [daemon] });

const sshdModule = {
  connectTo,
  deployedName,
  keygen,
  localConnection,
  posixAccountShell,
  publicKey,
  sshd,
  useSshd,
};

export default sshdModule;
