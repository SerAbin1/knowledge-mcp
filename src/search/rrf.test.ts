import { describe, expect, it } from "vite-plus/test";
import { reciprocalRankFusion } from "./rrf";

describe("reciprocalRankFusion", () => {
  it("ranks items found by both retrievers above items found by one", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["d", "b", "a"],
    ]);
    expect(fused.map((f) => f.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("ignores raw scores: only rank positions matter", () => {
    expect(reciprocalRankFusion([["x"]])[0].score).toBeCloseTo(1 / 61);
  });
});
