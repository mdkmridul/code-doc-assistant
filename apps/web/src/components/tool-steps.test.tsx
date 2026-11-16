import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolStep } from "@/lib/turns";
import { describeStep, ToolSteps } from "./tool-steps";

afterEach(cleanup);

const step = (overrides: Partial<ToolStep>): ToolStep => ({
  id: "s1",
  name: "search_code",
  input: { query: "retry delay" },
  status: "done",
  summary: "8 results",
  excerpts: [],
  ...overrides,
});

const steps: ToolStep[] = [
  step({ id: "a", input: { query: "retry delay", pathPrefix: "source/" }, summary: "8 results" }),
  step({
    id: "b",
    name: "read_file",
    input: { path: "source/core/Ky.ts", startLine: 664, endLine: 763 },
    summary: "source/core/Ky.ts:664-763 of 1400 lines",
  }),
  step({ id: "c", name: "read_file", input: { path: "src/missing.ts" }, status: "error", summary: "File not found: src/missing.ts." }),
  step({ id: "d", input: { query: "backoff" }, status: "running", summary: undefined }),
];

describe("ToolSteps", () => {
  it("renders nothing when the answer used no tools", () => {
    const { container } = render(<ToolSteps steps={[]} active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every step, in order, with what it did and how it went while the answer streams", () => {
    render(<ToolSteps steps={steps} active />);

    const list = screen.getByRole("list", { name: "Tool steps" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.dataset.status)).toEqual(["done", "done", "error", "running"]);

    expect(items[0]).toHaveTextContent("Searched code for “retry delay”");
    expect(items[0]).toHaveTextContent("in source/");
    expect(items[0]).toHaveTextContent("8 results");
    expect(items[1]).toHaveTextContent("Read source/core/Ky.ts:664-763");
    expect(items[1]).toHaveTextContent("of 1400 lines");
    expect(items[2]).toHaveTextContent("File not found: src/missing.ts.");
    expect(items[3]).toHaveTextContent("Running…");

    expect(screen.getByRole("button", { name: /Researching · 1 running/ })).toBeInTheDocument();
  });

  it("collapses to a summary once the answer is done, and expands on click", async () => {
    render(<ToolSteps steps={steps.slice(0, 3)} active={false} />);

    const toggle = screen.getByRole("button", { name: /Researched with 3 steps · 1 failed/ });
    expect(screen.queryByRole("list", { name: "Tool steps" })).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(screen.getByRole("list", { name: "Tool steps" })).toBeInTheDocument();
  });
});

describe("describeStep", () => {
  it("falls back to the tool name for tools it doesn't know", () => {
    expect(describeStep(step({ name: "list_files", input: {} })).label).toBe("Ran list_files");
  });
});
