import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECAP_VOICE,
  RECAP_BUBBLE_READING_WIDTH,
  RECAP_BUBBLE_RESTING,
  RECAP_VOICE_OPTIONS,
  activeLineIndex,
  grownWindow,
  lineWeights,
  normalizeRecapVoice,
  prompterScroll,
  recapSpeechFailureCopy,
  type RecapSpeechLine,
} from "./recapSpeech";

const lines = (count: number): RecapSpeechLine[] =>
  Array.from({ length: count }, (_, index) => ({ text: `7:0${index} PM Reviewed item ${index}`, time: `7:0${index} PM` }));

describe("recap voice settings", () => {
  it("keeps the shipped voices and falls back to the first", () => {
    expect(RECAP_VOICE_OPTIONS.length).toBeGreaterThanOrEqual(3);
    for (const option of RECAP_VOICE_OPTIONS) {
      expect(option.sample.startsWith("/voices/")).toBe(true);
      expect(option.sample.endsWith(".mp3")).toBe(true);
      expect(normalizeRecapVoice(option.id)).toBe(option.id);
    }
    expect(normalizeRecapVoice("Nope")).toBe(DEFAULT_RECAP_VOICE);
    expect(normalizeRecapVoice(undefined)).toBe(DEFAULT_RECAP_VOICE);
    expect(normalizeRecapVoice("  ")).toBe(DEFAULT_RECAP_VOICE);
  });
});

describe("the prompter's clock", () => {
  it("gives every line a share, longer lines a bigger one", () => {
    const weights = lineWeights([{ text: "Short", time: null }, { text: "A much longer line of work", time: null }]);
    expect(weights).toHaveLength(2);
    expect(weights[0]).toBeGreaterThanOrEqual(1);
    expect(weights[1]).toBeGreaterThan(weights[0]);
    expect(lineWeights([])).toEqual([]);
  });

  it("lands on the last line exactly when the audio ends", () => {
    const weights = lineWeights(lines(5));
    expect(activeLineIndex(0, weights)).toBe(0);
    expect(activeLineIndex(1, weights)).toBe(4);
    expect(activeLineIndex(-3, weights)).toBe(0);
    expect(activeLineIndex(Number.NaN, weights)).toBe(0);
    expect(activeLineIndex(1.4, weights)).toBe(4);
    expect(activeLineIndex(0.8, [1])).toBe(0);
  });

  it("never jumps backwards while the audio moves forward", () => {
    const weights = lineWeights(lines(6));
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const index = activeLineIndex(step / 100, weights);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
    expect(previous).toBe(5);
  });

  it("travels the whole distance across the lines, weighted like the highlight", () => {
    const weights = lineWeights(lines(4));
    expect(prompterScroll(0, weights)).toBe(0);
    expect(prompterScroll(1, weights)).toBeCloseTo(1, 5);
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const scroll = prompterScroll(step / 100, weights);
      expect(scroll).toBeGreaterThanOrEqual(previous);
      previous = scroll;
    }
    // A single line has nowhere to travel.
    expect(prompterScroll(0.5, [1])).toBe(0);
    expect(prompterScroll(0.5, [])).toBe(0);
  });
});

describe("the window while it reads", () => {
  const metrics = { lineHeight: 19, prompterLines: 3, chrome: 96 };
  const monitor = { width: 1440, height: 900 };

  it("grows upward from its resting size when the monitor has room above", () => {
    // The companion resting at the bottom-right, where it usually sits.
    const resting = { x: monitor.width - RECAP_BUBBLE_RESTING.width, y: monitor.height - RECAP_BUBBLE_RESTING.height };
    const grown = grownWindow(RECAP_BUBBLE_RESTING, metrics, monitor, resting);
    expect(grown.size.width).toBe(RECAP_BUBBLE_READING_WIDTH);
    expect(grown.size.height).toBe(RECAP_BUBBLE_RESTING.height + 19 * 3 + 96);
    // The bottom edge holds still, so the mascot and the elapsed pill do not move.
    expect(grown.position.y + grown.size.height).toBe(monitor.height);
    // The extra width is added about the mascot's centre; at a screen edge the
    // window is pulled back in, which is the most the mascot may shift.
    expect(grown.position.x + grown.size.width).toBeLessThanOrEqual(monitor.width);
    const restingCentre = resting.x + RECAP_BUBBLE_RESTING.width / 2;
    const grownCentre = grown.position.x + grown.size.width / 2;
    expect(Math.abs(grownCentre - restingCentre)).toBeLessThanOrEqual((RECAP_BUBBLE_READING_WIDTH - RECAP_BUBBLE_RESTING.width) / 2);
  });

  it("grows downward instead when the companion sits against the top", () => {
    const grown = grownWindow(RECAP_BUBBLE_RESTING, metrics, monitor, { x: 40, y: 10 });
    expect(grown.position.y).toBe(10);
    expect(grown.size.height).toBeGreaterThan(RECAP_BUBBLE_RESTING.height);
  });

  it("never leaves the monitor, however the companion is placed", () => {
    const grown = grownWindow(RECAP_BUBBLE_RESTING, metrics, monitor, { x: 1400, y: 890 });
    expect(grown.size.height).toBeLessThanOrEqual(monitor.height);
    expect(grown.position.x + grown.size.width).toBeLessThanOrEqual(monitor.width);
    expect(grown.position.y).toBeGreaterThanOrEqual(0);
    expect(grown.position.y + grown.size.height).toBeLessThanOrEqual(monitor.height);
  });

  it("stays at its resting width on a narrow monitor", () => {
    const grown = grownWindow(RECAP_BUBBLE_RESTING, metrics, { width: 320, height: 700 }, { x: 10, y: 300 });
    expect(grown.size.width).toBe(RECAP_BUBBLE_RESTING.width);
  });
});

describe("failure copy", () => {
  it("says what to do instead of what broke", () => {
    expect(recapSpeechFailureCopy("offline")).toMatch(/still read it below/);
    expect(recapSpeechFailureCopy("unavailable")).toMatch(/Try again/);
    for (const copy of [recapSpeechFailureCopy("offline"), recapSpeechFailureCopy("unavailable")]) {
      expect(copy).not.toMatch(/fal|provider|HTTP|\d{3}/i);
    }
  });
});
