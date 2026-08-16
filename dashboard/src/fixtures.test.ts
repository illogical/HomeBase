// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  createFixtureDataSource,
  FixtureDashboardDataSource,
  selectFixtureScenario,
} from "./fixtures";

describe("fixture dashboard data", () => {
  it("returns a deterministic frozen mixed scenario with all required card states", async () => {
    const applications = await createFixtureDataSource("").listApplications();

    expect(Object.isFrozen(applications)).toBe(true);
    expect(applications.map(({ id }) => id)).toEqual([
      "devplanner",
      "lmapi",
      "memoryapi",
      "lmeval",
    ]);
    expect(applications.map(({ state }) => state)).toEqual([
      "ready",
      "degraded",
      "disabled",
      "unavailable",
    ]);
    expect(applications.every(Object.isFrozen)).toBe(true);
    expect(applications.every(({ statusSummary }) => statusSummary.startsWith("Sample status:"))).toBe(true);
  });

  it("returns one shared frozen empty result", async () => {
    const source = new FixtureDashboardDataSource("empty");
    const first = await source.listApplications();
    const second = await source.listApplications();

    expect(first).toBe(second);
    expect(first).toEqual([]);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("keeps the loading scenario pending until it is aborted", async () => {
    const source = new FixtureDashboardDataSource("loading");
    const controller = new AbortController();
    const result = source.listApplications(controller.signal);

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("selects documented scenarios and falls back to mixed", () => {
    expect(selectFixtureScenario("?fixture=loading")).toBe("loading");
    expect(selectFixtureScenario("?fixture=empty")).toBe("empty");
    expect(selectFixtureScenario("?fixture=mixed")).toBe("mixed");
    expect(selectFixtureScenario("?fixture=unknown")).toBe("mixed");
    expect(selectFixtureScenario("?other=value")).toBe("mixed");
  });
});
