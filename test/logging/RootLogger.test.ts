import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RootLogger } from "../../src/logging/RootLogger.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempDataRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "homebase-rootlogger-"));
  directories.push(directory);
  return directory;
}

async function readLogLines(dataRoot: string): Promise<Array<Record<string, unknown>>> {
  const filePath = path.join(dataRoot, "homebase", "log", "homebase.ndjson");
  const content = await readFile(filePath, "utf8");
  return content
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("RootLogger", () => {
  it("emits the documented NDJSON fields with traceId/spanId absent", async () => {
    const dataRoot = await tempDataRoot();
    const logger = RootLogger.create({ dataRoot, environment: { NODE_ENV: "production" } });

    logger.log("info", "startup-begin", "HomeBase is starting.", { attempt: 1 });
    await logger.flush(2000);

    const [record] = await readLogLines(dataRoot);
    expect(record).toMatchObject({
      severityText: "info",
      body: "HomeBase is starting.",
      eventName: "startup-begin",
      serviceName: "homebase",
    });
    expect(typeof record?.timestamp).toBe("string");
    expect(typeof record?.serviceInstanceId).toBe("string");
    expect(record).not.toHaveProperty("traceId");
    expect(record).not.toHaveProperty("spanId");
  });

  it("binds a child logger to an applicationId that cannot be overridden", async () => {
    const dataRoot = await tempDataRoot();
    const logger = RootLogger.create({ dataRoot, environment: { NODE_ENV: "production" } });
    const child = logger.child({ applicationId: "fixture-routes", component: "router" });
    const grandchild = child.child({ applicationId: "someone-else" });

    child.log("info", "mounted", "Router mounted.");
    grandchild.log("info", "mounted-again", "Still mounted.");
    await logger.flush(2000);

    const records = await readLogLines(dataRoot);
    expect(records.every((record) => record.applicationId === "fixture-routes")).toBe(true);
  });

  it("never lets a canary secret reach the NDJSON file", async () => {
    const dataRoot = await tempDataRoot();
    const logger = RootLogger.create({ dataRoot, environment: { NODE_ENV: "production" } });

    logger.log("error", "auth-failure", "Authorization failed.", {
      authorization: "Bearer canary-secret-value",
      apiToken: "canary-secret-value",
    });
    await logger.flush(2000);

    const filePath = path.join(dataRoot, "homebase", "log", "homebase.ndjson");
    const content = await readFile(filePath, "utf8");
    expect(content).not.toContain("canary-secret-value");
  });

  it("suppresses records below the configured minimum level", async () => {
    const dataRoot = await tempDataRoot();
    const logger = RootLogger.create({
      dataRoot,
      environment: { NODE_ENV: "production", HOMEBASE_LOG_LEVEL: "warn" },
    });

    logger.log("info", "ignored", "Should not be written.");
    logger.log("warn", "kept", "Should be written.");
    await logger.flush(2000);

    const records = await readLogLines(dataRoot);
    expect(records).toHaveLength(1);
    expect(records[0]?.eventName).toBe("kept");
  });

  it("mirrors info-and-above records to the console outside production", async () => {
    const dataRoot = await tempDataRoot();
    const logger = RootLogger.create({ dataRoot, environment: { NODE_ENV: "development" } });
    const calls: unknown[][] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };

    try {
      logger.log("info", "mirrored", "This should reach the console.");
      await logger.flush(2000);
    } finally {
      console.log = original;
    }

    expect(calls.some((call) => call.join(" ").includes("mirrored"))).toBe(true);
  });

  it("bounds flush to the requested deadline even under sustained writes", async () => {
    const dataRoot = await tempDataRoot();
    const logger = RootLogger.create({ dataRoot, environment: { NODE_ENV: "production" } });

    for (let index = 0; index < 25; index += 1) {
      logger.log("info", `event-${index}`, "bulk write");
    }

    const started = Date.now();
    await logger.flush(2000);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
