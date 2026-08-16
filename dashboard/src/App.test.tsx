// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { FixtureDashboardDataSource } from "./fixtures";
import type { DashboardApplication, DashboardDataSource } from "./models";

describe("dashboard application", () => {
  it("renders the semantic mixed fixture without launch controls", async () => {
    render(<App dataSource={new FixtureDashboardDataSource("mixed")} />);

    expect(screen.getByRole("heading", { level: 1, name: "Application dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Prototype data notice" })).toHaveTextContent(
      "sample data",
    );
    const list = await screen.findByRole("list");
    const cards = within(list).getAllByRole("article");
    expect(cards).toHaveLength(4);

    const expectations = [
      ["DevPlanner", "Ready", "/devplanner/"],
      ["LMApi", "Degraded", "/lmapi/"],
      ["MemoryApi", "Disabled", "/memoryapi/"],
      ["LMEval", "Unavailable", "/lmeval/"],
    ] as const;

    for (const [name, state, route] of expectations) {
      const card = screen.getByRole("heading", { level: 3, name }).closest("article");
      expect(card).not.toBeNull();
      const scoped = within(card as HTMLElement);
      expect(scoped.getByText(state)).toBeInTheDocument();
      expect(scoped.getByText(route)).toBeInTheDocument();
      expect(scoped.queryByRole("link")).not.toBeInTheDocument();
      expect(scoped.queryByRole("button")).not.toBeInTheDocument();
    }
  });

  it("renders an accessible stable loading presentation", () => {
    const { container } = render(<App dataSource={new FixtureDashboardDataSource("loading")} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading sample applications.");
    expect(screen.getByRole("heading", { level: 2, name: "Applications" }).closest("section")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelector(".skeleton-grid")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the calm empty fixture", async () => {
    render(<App dataSource={new FixtureDashboardDataSource("empty")} />);

    expect(await screen.findByRole("heading", { level: 2, name: "No sample applications" })).toBeInTheDocument();
    expect(screen.getByText(/intentionally shows how HomeBase looks/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts the data source when the app unmounts", () => {
    let receivedSignal: AbortSignal | undefined;
    const dataSource: DashboardDataSource = {
      listApplications(signal) {
        receivedSignal = signal;
        return new Promise<readonly DashboardApplication[]>(() => undefined);
      },
    };
    const { unmount } = render(<App dataSource={dataSource} />);

    expect(receivedSignal?.aborted).toBe(false);
    unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("makes the skip link first in keyboard order and moves focus to main", async () => {
    const user = userEvent.setup();
    render(<App dataSource={new FixtureDashboardDataSource("mixed")} />);

    await user.tab();
    const skipLink = screen.getByRole("link", { name: "Skip to applications" });
    expect(skipLink).toHaveFocus();
    await user.click(skipLink);
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it.each(["mixed", "loading", "empty"] as const)(
    "has no automated accessibility violations in the %s fixture",
    async (scenario) => {
      const { container } = render(<App dataSource={new FixtureDashboardDataSource(scenario)} />);
      if (scenario !== "loading") {
        await waitFor(() => {
          expect(screen.queryByRole("status")).not.toBeInTheDocument();
        });
      }

      const result = await axe.run(container);
      expect(result.violations).toEqual([]);
    },
  );

  it("shows a quiet empty-state failure for unexpected data-source errors", async () => {
    const dataSource: DashboardDataSource = {
      listApplications: vi.fn(async () => Promise.reject(new Error("fixture failure"))),
    };
    render(<App dataSource={dataSource} />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Sample applications could not be loaded" }),
    ).toBeInTheDocument();
  });
});
