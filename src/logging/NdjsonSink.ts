import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const DEFAULT_MAX_ACTIVE_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_RETAINED_ROTATED_FILES = 7;
const DEFAULT_MAX_TOTAL_LOG_BYTES = 500 * 1024 * 1024;

export interface NdjsonSinkOptions {
  readonly maxActiveFileBytes?: number;
  readonly maxRetainedRotatedFiles?: number;
  readonly maxTotalLogBytes?: number;
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rotationSuffix(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export class NdjsonSink {
  readonly #filePath: string;
  readonly #directory: string;
  readonly #baseName: string;
  #stream: WriteStream | undefined;
  #currentSize = 0;
  #currentDay: string;
  #degraded = false;
  #pending: Promise<void> = Promise.resolve();
  readonly #maxActiveFileBytes: number;
  readonly #maxRetainedRotatedFiles: number;
  readonly #maxTotalLogBytes: number;

  constructor(filePath: string, options: NdjsonSinkOptions = {}) {
    this.#filePath = filePath;
    this.#directory = dirname(filePath);
    this.#baseName = basename(filePath);
    this.#currentDay = utcDay(new Date());
    this.#maxActiveFileBytes = options.maxActiveFileBytes ?? DEFAULT_MAX_ACTIVE_FILE_BYTES;
    this.#maxRetainedRotatedFiles =
      options.maxRetainedRotatedFiles ?? DEFAULT_MAX_RETAINED_ROTATED_FILES;
    this.#maxTotalLogBytes = options.maxTotalLogBytes ?? DEFAULT_MAX_TOTAL_LOG_BYTES;
  }

  get degraded(): boolean {
    return this.#degraded;
  }

  write(line: string): void {
    this.#pending = this.#pending.then(
      () => this.#writeLine(line),
      () => this.#writeLine(line),
    );
  }

  async flush(deadlineMs = 2000): Promise<void> {
    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, deadlineMs);
      timer.unref?.();
    });
    await Promise.race([this.#pending.catch(() => undefined), timeout]);
  }

  async close(): Promise<void> {
    await this.flush();
    await this.#endStream();
  }

  async #writeLine(line: string): Promise<void> {
    try {
      const today = utcDay(new Date());
      if (today !== this.#currentDay) {
        await this.#rotate();
        this.#currentDay = today;
      }
      const bytes = Buffer.byteLength(line, "utf8") + 1;
      if (this.#currentSize > 0 && this.#currentSize + bytes > this.#maxActiveFileBytes) {
        await this.#rotate();
      }
      const stream = await this.#ensureStream();
      await new Promise<void>((resolve, reject) => {
        stream.write(`${line}\n`, "utf8", (error) => (error ? reject(error) : resolve()));
      });
      this.#currentSize += bytes;
      this.#degraded = false;
    } catch (error) {
      this.#fallbackToStderr(line, error);
    }
  }

  #fallbackToStderr(droppedLine: string, error: unknown): void {
    this.#degraded = true;
    try {
      const record = {
        timestamp: new Date().toISOString(),
        severityText: "error",
        eventName: "logging-degraded",
        body: "NDJSON sink write failed; record dropped and diverted to stderr.",
        error: error instanceof Error ? error.message : String(error),
        droppedRecord: droppedLine,
      };
      process.stderr.write(`${JSON.stringify(record)}\n`);
    } catch {
      // stderr itself is unavailable; nothing further can be done.
    }
  }

  async #ensureStream(): Promise<WriteStream> {
    if (this.#stream) return this.#stream;
    await mkdir(this.#directory, { recursive: true });
    const existing = await stat(this.#filePath).catch(() => undefined);
    this.#currentSize = existing?.size ?? 0;
    const stream = createWriteStream(this.#filePath, { flags: "a" });
    stream.on("error", () => {
      this.#degraded = true;
    });
    this.#stream = stream;
    return stream;
  }

  async #endStream(): Promise<void> {
    const stream = this.#stream;
    if (!stream) return;
    this.#stream = undefined;
    await new Promise<void>((resolve) => stream.end(() => resolve()));
  }

  async #rotate(): Promise<void> {
    await this.#endStream();
    const existing = await stat(this.#filePath).catch(() => undefined);
    if (existing && existing.isFile() && existing.size > 0) {
      const rotatedName = `${this.#baseName}.${rotationSuffix(new Date())}`;
      await rename(this.#filePath, join(this.#directory, rotatedName));
    }
    this.#currentSize = 0;
    await this.#enforceRetention();
  }

  async #enforceRetention(): Promise<void> {
    const entries = await readdir(this.#directory).catch(() => [] as string[]);
    const rotatedPrefix = `${this.#baseName}.`;
    const rotated = entries.filter((name) => name.startsWith(rotatedPrefix)).sort();

    while (rotated.length > this.#maxRetainedRotatedFiles) {
      const oldest = rotated.shift();
      if (oldest === undefined) break;
      await unlink(join(this.#directory, oldest)).catch(() => undefined);
    }

    const sized: Array<{ name: string; size: number }> = [];
    let total = 0;
    for (const name of rotated) {
      const details = await stat(join(this.#directory, name)).catch(() => undefined);
      if (details) {
        sized.push({ name, size: details.size });
        total += details.size;
      }
    }
    const activeDetails = await stat(this.#filePath).catch(() => undefined);
    total += activeDetails?.size ?? 0;

    let index = 0;
    while (total > this.#maxTotalLogBytes && index < sized.length) {
      const victim = sized[index];
      if (victim === undefined) break;
      await unlink(join(this.#directory, victim.name)).catch(() => undefined);
      total -= victim.size;
      index += 1;
    }
  }
}
