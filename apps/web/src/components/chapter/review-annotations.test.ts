import { describe, expect, it } from "vitest";
import {
  type AnnotationView,
  annotationCounts,
  layoutMarkerCenters,
  markerFraction,
  reviewAnnotations,
  showsAnnotation,
} from "./review-annotations.ts";
import type { Detail } from "./review-data.ts";

const notes: AnnotationView[] = [
  {
    id: "reader",
    kind: "reader",
    status: "open",
    usefulness: "useful",
    persisted: true,
  },
  {
    id: "editor",
    kind: "editor",
    status: "dismissed",
    usefulness: null,
    persisted: true,
  },
  {
    id: "plot",
    kind: "plot",
    status: "accepted",
    usefulness: null,
    persisted: true,
  },
  {
    id: "reality",
    kind: "reality",
    status: "open",
    usefulness: null,
    persisted: true,
  },
];

describe("chapter annotations", () => {
  it("positions located notes relative to the source and skips unusable offsets", () => {
    expect(markerFraction(25, 100)).toBe(0.25);
    expect(markerFraction(0, 100)).toBe(0);
    expect(markerFraction(100, 100)).toBe(1);
    expect(markerFraction(110, 100)).toBe(1);
    expect(markerFraction(-1, 100)).toBe(0);
    expect(markerFraction(undefined, 100)).toBeUndefined();
    expect(markerFraction(Number.NaN, 100)).toBeUndefined();
    expect(markerFraction(0, 0)).toBeUndefined();
  });

  it("keeps each marker clickable when anchors overlap or reach the rail edge", () => {
    expect(layoutMarkerCenters([1, 0, 1, 0, 0.5], 100)).toEqual({
      centers: [83, 5, 95, 17, 50],
      hitHeight: 10,
    });
    expect(layoutMarkerCenters([0, 0, 0], 18)).toEqual({
      centers: [3, 9, 15],
      hitHeight: 6,
    });
  });

  it("counts decisions independently of ratings and matches each filter", () => {
    expect(annotationCounts(notes)).toEqual({ total: 4, processed: 2 });
    expect(annotationCounts([])).toEqual({ total: 0, processed: 0 });
    expect(notes.filter((note) => showsAnnotation(note, "all"))).toEqual(notes);
    expect(
      notes.filter((note) => showsAnnotation(note, "open")).map(({ id }) => id),
    ).toEqual(["reader", "reality"]);
    expect(
      notes
        .filter((note) => showsAnnotation(note, "reader"))
        .map(({ id }) => id),
    ).toEqual(["reader"]);
    expect(
      notes
        .filter((note) => showsAnnotation(note, "editor"))
        .map(({ id }) => id),
    ).toEqual(["editor"]);
    expect(
      notes
        .filter((note) => showsAnnotation(note, "verification"))
        .map(({ id }) => id),
    ).toEqual(["plot", "reality"]);
  });

  it("binds feedback to the original array index and keeps unmatched reports readable", () => {
    const reports = {
      "qinggan-duzhe": {
        output: {
          reactions: [
            null,
            { anchor: "桥", type: "noticed", note: "先看到桥。" },
          ],
        },
      },
      "wenxue-bianji": {
        output: {
          edits: [
            {
              original: "河",
              replacement: "溪",
              reason: "核对地貌。",
              kind: "fact",
            },
          ],
        },
      },
    };
    const annotations = [
      { ...notes[0], id: "persisted", roleId: "qinggan-duzhe", index: 1 },
    ];
    const review = reviewAnnotations({
      reports,
      annotations,
    } as unknown as Detail);
    expect(review.readers[0]?.annotation).toMatchObject({
      id: "persisted",
      persisted: true,
      usefulness: "useful",
    });
    expect(review.editors[0]?.annotation).toMatchObject({
      persisted: false,
      status: "open",
    });
  });
});
