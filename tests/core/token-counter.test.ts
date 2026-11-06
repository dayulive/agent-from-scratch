import { describe, expect, it } from "vitest";
import { TokenCounter } from "../../src/core/token-counter.js";

describe("TokenCounter", () => {
  it("释放后拒绝继续计数", () => {
    const counter = new TokenCounter();
    expect(counter.count("hello")).toBeGreaterThan(0);
    counter.dispose();
    expect(() => counter.count("hello")).toThrow("释放");
  });
});
