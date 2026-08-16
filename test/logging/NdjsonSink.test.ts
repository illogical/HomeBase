import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NdjsonSink } from "../../src/logging/NdjsonSink.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempLogFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "homebase-ndjson-"));
  directories.push(directory);
  return path.join(directory, "homebase.ndjson");
}

describe("NdjsonSink", () => {
  it("appends well-formed NDJSON lines and flushes them within the deadline", async () => {
    const filePath = await tempLogFile();
    const sink = new NdjsonSink(filePath);

    sink.write(JSON.stringify({ eventName: "one" }));
    sink.write(JSON.stringify({ eventName: "two" }));
    await sink.flush(2000);
    await sink.close();

    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ eventName: "one" });
    expect(JSON.parse(lines[1]!)).toEqual({ eventName: "two" });
  });

  it("rotates when the active file would exceed the configured size boundary", async () => {
    const filePath = await tempLogFile();
    const sink = new NdjsonSink(filePath, { maxActiveFileBytes: 100 });

    for (let index = 0; index < 10; index += 1) {
      sink.write(JSON.stringify({ eventName: `event-${index}`, padding: "x".repeat(20) }));
    }
    await sink.flush(2000);
    await sink.close();

    const directory = path.dirname(filePath);
    const entries = await readdir(directory);
    const rotated = entries.filter((name) => name.startsWith("homebase.ndjson."));
    expect(rotated.length).toBeGreaterThan(0);
  });

  it("retains at most the configured number of rotated files", async () => {
    const filePath = await tempLogFile();
    const sink = new NdjsonSink(filePath, {
      maxActiveFileBytes: 40,
      maxRetainedRotatedFiles: 2,
    });

    for (let index = 0; index < 40; index += 1) {
      sink.write(JSON.stringify({ eventName: `event-${index}` }));
      await sink.flush(2000);
    }
    await sink.close();

    const directory = path.dirname(filePath);
    const entries = await readdir(directory);
    const rotated = entries.filter((name) => name.startsWith("homebase.ndjson."));
    expect(rotated.length).toBeLessThanOrEqual(2);
  });

  it("falls back to stderr and marks degraded when the target directory cannot be created", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "homebase-ndjson-"));
    directories.push(directory);
    const blockingFile = path.join(directory, "not-a-directory");
    await writeFile(blockingFile, "blocked", "utf8");
    const filePath = path.join(blockingFile, "homebase.ndjson");
    const sink = new NdjsonSink(filePath);
    const stderrWrite = process.stderr.write.bind(process.stderr);
    const captured: string[] = [];
    process.stderr.write = ((chunk: string) => {
      captured.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      sink.write(JSON.stringify({ eventName: "unreachable" }));
      await sink.flush(2000);
    } finally {
      process.stderr.write = stderrWrite;
    }

    expect(sink.degraded).toBe(true);
    expect(captured.some((line) => line.includes("logging-degraded"))).toBe(true);
  });

  it("does not throw when flush is called with no pending writes", async () => {
    const filePath = await tempLogFile();
    const sink = new NdjsonSink(filePath);
    await expect(sink.flush(50)).resolves.toBeUndefined();
  });
});
