import { describe, expect, it } from "vite-plus/test";
import { getRowBottom, timelineContentOverflowsViewport } from "./timelineScroll";

function buildState({
  positions,
  sizes,
  scroll = 0,
  scrollLength = 700,
}: {
  readonly positions: readonly number[];
  readonly sizes: readonly number[];
  readonly scroll?: number;
  readonly scrollLength?: number;
}) {
  return {
    data: positions.map((_, index) => index),
    scroll,
    scrollLength,
    positionAtIndex: (index: number) => positions[index],
    sizeAtIndex: (index: number) => sizes[index],
  };
}

describe("timeline scroll", () => {
  it("measures row bottoms from LegendList row position and size", () => {
    const state = buildState({
      positions: [0, 120],
      sizes: [80, 40],
    });

    expect(getRowBottom(state, 1)).toBe(160);
  });

  it("treats content that fits above the composer as non-overflowing", () => {
    const state = buildState({
      positions: [0, 300],
      sizes: [240, 120],
      scrollLength: 760,
    });

    expect(timelineContentOverflowsViewport({ state, composerOverlayHeight: 0 })).toBe(false);
  });

  it("subtracts the composer overlay from the visible viewport", () => {
    const state = buildState({
      positions: [0, 300],
      sizes: [120, 300],
      scrollLength: 700,
    });

    expect(timelineContentOverflowsViewport({ state, composerOverlayHeight: 0 })).toBe(false);
    expect(timelineContentOverflowsViewport({ state, composerOverlayHeight: 220 })).toBe(true);
  });

  it("reports no overflow when the list is empty or unmeasured", () => {
    expect(
      timelineContentOverflowsViewport({
        state: buildState({ positions: [], sizes: [] }),
        composerOverlayHeight: 0,
      }),
    ).toBe(false);
    expect(
      timelineContentOverflowsViewport({
        state: buildState({ positions: [0], sizes: [Number.NaN] }),
        composerOverlayHeight: 0,
      }),
    ).toBe(false);
  });
});
