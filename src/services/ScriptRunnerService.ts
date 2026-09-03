import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { Namespace } from "socket.io";
import type { PackageScriptsService } from "./PackageScriptsService.js";

export type RunStatus = "running" | "exited" | "killed" | "error";

export interface OutputChunk {
  readonly seq: number;
  readonly stream: "stdout" | "stderr";
  readonly data: string;
  readonly timestamp: string;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly applicationId: string;
  readonly scriptName: string;
  readonly status: RunStatus;
  readonly exitCode: number | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly output: readonly OutputChunk[];
}

export type StartRunResult =
  | { readonly runId: string; readonly startedAt: string }
  | { readonly conflict: true; readonly runId: string }
  | { readonly error: "unknown-script" };

export type StopRunResult = { readonly ok: true } | { readonly error: "not-found" };

const MAX_BUFFERED_CHUNKS = 2000;
const KILL_GRACE_MS = 5000;
const KNOWN_PACKAGE_MANAGERS = new Set(["npm", "yarn", "pnpm"]);

interface RunRecord {
  readonly runId: string;
  readonly applicationId: string;
  readonly scriptName: string;
  readonly child: ChildProcess;
  readonly outputBuffer: OutputChunk[];
  readonly startedAt: string;
  status: RunStatus;
  exitCode: number | null;
  finishedAt: string | null;
  nextSeq: number;
  killRequested: boolean;
  killTimer: NodeJS.Timeout | null;
}

export class ScriptRunnerService {
  readonly #packageScriptsService: PackageScriptsService;
  readonly #runsByApplication = new Map<string, RunRecord>();
  readonly #runsById = new Map<string, RunRecord>();
  #namespace: Namespace | undefined;

  constructor(packageScriptsService: PackageScriptsService) {
    this.#packageScriptsService = packageScriptsService;
    process.once("exit", () => this.#killAllSync());
  }

  attachNamespace(namespace: Namespace): void {
    this.#namespace = namespace;
    namespace.on("connection", (socket) => {
      socket.on("join-run", (runId: unknown) => {
        if (typeof runId === "string") {
          void socket.join(`run:${runId}`);
        }
      });
      socket.on("leave-run", (runId: unknown) => {
        if (typeof runId === "string") {
          void socket.leave(`run:${runId}`);
        }
      });
    });
  }

  async run(
    applicationId: string,
    repositoryRoot: string,
    packageManager: string | undefined,
    scriptName: string,
  ): Promise<StartRunResult> {
    const existing = this.#runsByApplication.get(applicationId);
    if (existing !== undefined && existing.status === "running") {
      return { conflict: true, runId: existing.runId };
    }

    const scriptsResult = await this.#packageScriptsService.getScripts(repositoryRoot);
    if (scriptsResult.scripts[scriptName] === undefined) {
      return { error: "unknown-script" };
    }

    const command = KNOWN_PACKAGE_MANAGERS.has(packageManager ?? "") ? (packageManager as string) : "npm";
    const child = spawn(command, ["run", scriptName], {
      cwd: repositoryRoot,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const record: RunRecord = {
      runId,
      applicationId,
      scriptName,
      child,
      outputBuffer: [],
      startedAt,
      status: "running",
      exitCode: null,
      finishedAt: null,
      nextSeq: 0,
      killRequested: false,
      killTimer: null,
    };
    this.#runsByApplication.set(applicationId, record);
    this.#runsById.set(runId, record);

    child.stdout?.on("data", (data: Buffer) => this.#recordOutput(record, "stdout", data));
    child.stderr?.on("data", (data: Buffer) => this.#recordOutput(record, "stderr", data));
    child.on("error", () => this.#finish(record, "error", null));
    child.on("exit", (code) => {
      this.#finish(record, record.killRequested ? "killed" : "exited", code);
    });

    return { runId, startedAt };
  }

  async stop(runId: string): Promise<StopRunResult> {
    const record = this.#runsById.get(runId);
    if (record === undefined) {
      return { error: "not-found" };
    }
    if (record.status !== "running") {
      return { ok: true };
    }
    record.killRequested = true;
    this.#killProcessGroup(record.child, "SIGTERM");
    record.killTimer = setTimeout(() => {
      this.#killProcessGroup(record.child, "SIGKILL");
    }, KILL_GRACE_MS);
    return { ok: true };
  }

  getCurrentRun(applicationId: string): RunSnapshot | undefined {
    const record = this.#runsByApplication.get(applicationId);
    return record === undefined ? undefined : toSnapshot(record);
  }

  getRun(runId: string): RunSnapshot | undefined {
    const record = this.#runsById.get(runId);
    return record === undefined ? undefined : toSnapshot(record);
  }

  #recordOutput(record: RunRecord, stream: "stdout" | "stderr", data: Buffer): void {
    const chunk: OutputChunk = {
      seq: record.nextSeq++,
      stream,
      data: data.toString("utf8"),
      timestamp: new Date().toISOString(),
    };
    record.outputBuffer.push(chunk);
    if (record.outputBuffer.length > MAX_BUFFERED_CHUNKS) {
      record.outputBuffer.shift();
    }
    this.#namespace?.to(`run:${record.runId}`).emit("output", { runId: record.runId, ...chunk });
  }

  #finish(record: RunRecord, status: RunStatus, exitCode: number | null): void {
    if (record.status !== "running") {
      return;
    }
    if (record.killTimer !== null) {
      clearTimeout(record.killTimer);
      record.killTimer = null;
    }
    record.status = status;
    record.exitCode = exitCode;
    record.finishedAt = new Date().toISOString();
    this.#namespace?.to(`run:${record.runId}`).emit("status", toSnapshot(record));
  }

  #killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    if (child.pid === undefined) {
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      // Process group already gone.
    }
  }

  #killAllSync(): void {
    for (const record of this.#runsById.values()) {
      if (record.status === "running") {
        this.#killProcessGroup(record.child, "SIGKILL");
      }
    }
  }
}

function toSnapshot(record: RunRecord): RunSnapshot {
  return {
    runId: record.runId,
    applicationId: record.applicationId,
    scriptName: record.scriptName,
    status: record.status,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    output: record.outputBuffer,
  };
}
