"use client";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { annotationCopy as c } from "../../copy/zh-CN.ts";
import {
  type AnnotationView,
  layoutMarkerCenters,
} from "./review-annotations.ts";

export interface AnnotationMarker {
  annotation: AnnotationView;
  fraction: number;
  label: string;
}

export function AnnotationRail({
  paper,
  markers,
  active,
  onActivate,
}: {
  paper: RefObject<HTMLElement | null>;
  markers: readonly AnnotationMarker[];
  active: string | undefined;
  onActivate: (id: string) => void;
}) {
  const track = useRef<HTMLFieldSetElement>(null);
  useLayoutEffect(() => {
    const surface = paper.current;
    const rail = track.current;
    if (!surface || !rail) return;
    const header = document.querySelector(".project-bar");
    const dock = surface
      .closest(".chapter-workspace")
      ?.querySelector(".chapter-dock");
    const fractions = markers.map(({ fraction }) => fraction);
    const buttons = rail.querySelectorAll<HTMLButtonElement>("button");
    let frame = 0;
    function place() {
      if (!surface || !rail) return;
      const rect = surface.getBoundingClientRect();
      const top = Math.max(
        rect.top,
        header?.getBoundingClientRect().bottom ?? 0,
        0,
      );
      const bottom = Math.min(
        rect.bottom,
        dock?.getBoundingClientRect().top ?? window.innerHeight,
        window.innerHeight,
      );
      const height = Math.max(0, bottom - top);
      rail.hidden = height === 0;
      rail.style.top = `${top - rect.top}px`;
      rail.style.height = `${height}px`;
      const { centers, hitHeight } = layoutMarkerCenters(fractions, height);
      buttons.forEach((button, index) => {
        button.style.top = `${centers[index]}px`;
        button.style.height = `${hitHeight}px`;
      });
    }
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    }
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(surface);
    if (header) observer.observe(header);
    if (dock) observer.observe(dock);
    window.addEventListener("scroll", schedule, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [paper, markers]);
  return (
    <fieldset
      ref={track}
      className="chapter-annotation-rail"
      aria-label={c.markers}
    >
      {markers.map(({ annotation, label }) => (
        <button
          type="button"
          key={annotation.id}
          className={`chapter-annotation-marker is-${annotation.kind}`}
          aria-label={label}
          title={label}
          aria-controls={`chapter-opinion-${annotation.id}`}
          aria-pressed={active === annotation.id}
          data-processed={annotation.status !== "open"}
          onClick={() => onActivate(annotation.id)}
        />
      ))}
    </fieldset>
  );
}
