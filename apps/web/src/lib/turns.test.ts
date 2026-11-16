import { describe, expect, it } from "vitest";
import { withoutCitationBlock } from "./turns";

describe("withoutCitationBlock", () => {
  it("drops the citation block that ends a final answer", () => {
    expect(withoutCitationBlock('Retries are in `src/retry.ts:2-5`.\n\n<citations>{"found":true')).toBe(
      "Retries are in `src/retry.ts:2-5`.",
    );
  });

  it("hides the opening tag while it is still streaming in", () => {
    expect(withoutCitationBlock("The answer.\n\n<cit")).toBe("The answer.");
    expect(withoutCitationBlock("The answer.\n<")).toBe("The answer.");
  });

  it("leaves other text alone", () => {
    expect(withoutCitationBlock("a < b and <code>")).toBe("a < b and <code>");
  });
});
