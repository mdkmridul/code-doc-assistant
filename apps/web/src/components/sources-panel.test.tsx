import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/lib/turns";
import { SourcesPanel } from "./sources-panel";

afterEach(cleanup);

// jsdom has no layout: scrolling is recorded, not performed.
const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

const source = (path: string, startLine: number, lines: string[], kind: Source["source"] = "read"): Source => ({
  key: `${path}:${startLine}-${startLine + lines.length - 1}`,
  path,
  startLine,
  endLine: startLine + lines.length - 1,
  text: lines.join("\n"),
  source: kind,
});

const sources = [
  source("src/retry.ts", 10, ["function retry() {", "  wait();", "  again();", "}"]),
  source("src/client.ts", 1, ["export const client = {};"], "search"),
];

describe("SourcesPanel", () => {
  it("lists every source with its path, line range, numbered code and how it was read", () => {
    render(<SourcesPanel state={{ kind: "ready", sources, live: false }} citation={null} />);

    const cards = within(screen.getByRole("list", { name: "Sources" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("src/retry.ts");
    expect(cards[0]).toHaveTextContent("lines 10–13");
    expect(cards[0]).toHaveTextContent("Read with read_file");
    expect(cards[1]).toHaveTextContent("line 1");
    expect(cards[1]).toHaveTextContent("Search hit (snippet)");
    expect(within(cards[0]).getByText("12")).toBeInTheDocument(); // line numbers
  });

  it("highlights exactly the cited lines of the overlapping source and scrolls it into view", () => {
    render(
      <SourcesPanel
        state={{ kind: "ready", sources, live: false }}
        citation={{ path: "src/retry.ts", startLine: 11, endLine: 12 }}
      />,
    );

    const cards = within(screen.getByRole("list", { name: "Sources" })).getAllByRole("listitem");
    expect(cards[0]).toHaveAttribute("data-cited");
    expect(cards[1]).not.toHaveAttribute("data-cited");
    const hits = [...cards[0].querySelectorAll("[data-hit]")].map((line) => line.textContent);
    expect(hits).toEqual(["11  wait();", "12  again();"]);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("shows readable empty, loading and error states", () => {
    const { rerender } = render(<SourcesPanel state={{ kind: "empty", reason: "no-sources" }} citation={null} />);
    expect(screen.getByText("No code was read")).toBeInTheDocument();

    rerender(<SourcesPanel state={{ kind: "loading" }} citation={null} />);
    expect(screen.getByLabelText("Loading sources")).toBeInTheDocument();

    rerender(<SourcesPanel state={{ kind: "error", message: "The daily spending limit was reached." }} citation={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The daily spending limit was reached.");
  });
});
