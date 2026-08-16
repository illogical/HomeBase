// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpDashboardDataSource } from "./httpDataSource";

const validEntry = {
  id: "devplanner",
  displayName: "DevPlanner",
  description: "Plan development work.",
  basePath: "/devplanner/",
  state: "unavailable",
  statusSummary: "Hosted adapter loading is not implemented yet.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpDashboardDataSource", () => {
  it("fetches and validates a well-formed listing", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([validEntry]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const applications = await new HttpDashboardDataSource().listApplications();

    expect(fetchMock).toHaveBeenCalledWith("/api/applications", { signal: null });
    expect(applications).toEqual([validEntry]);
    expect(Object.isFrozen(applications)).toBe(true);
    expect(Object.isFrozen(applications[0])).toBe(true);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );

    await expect(new HttpDashboardDataSource().listApplications()).rejects.toThrow(
      "Application listing request failed with status 500.",
    );
  });

  it("throws on a malformed payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ not: "an array" }), { status: 200 })),
    );

    await expect(new HttpDashboardDataSource().listApplications()).rejects.toThrow(
      "Application listing response was not an array.",
    );
  });

  it("throws on an unknown state value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify([{ ...validEntry, state: "bogus" }]), { status: 200 }),
      ),
    );

    await expect(new HttpDashboardDataSource().listApplications()).rejects.toThrow(
      "Application listing entry had an unknown state.",
    );
  });

  it("propagates a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("network down"))),
    );

    await expect(new HttpDashboardDataSource().listApplications()).rejects.toThrow(
      "network down",
    );
  });

  it("propagates an abort", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new DOMException("aborted", "AbortError"))),
    );

    controller.abort();
    await expect(
      new HttpDashboardDataSource().listApplications(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
