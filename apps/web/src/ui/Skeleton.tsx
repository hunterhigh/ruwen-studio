"use client";
import { type ReactNode, useEffect, useState } from "react";
import { statusCopy as c } from "../copy/zh-CN.ts";
import { Button } from "./Button.tsx";
import { observeSlowLoad } from "./slow-load.ts";

type Shape =
  | "line"
  | "short"
  | "heading"
  | "cover"
  | "circle"
  | "field"
  | "block";
type Page = keyof typeof c.pending;

export function Skeleton({ shape = "line" }: { shape?: Shape }) {
  return <span className={`ui-skeleton ui-skeleton--${shape}`} />;
}

function Lines({
  count,
  startShort = false,
}: {
  count: number;
  startShort?: boolean;
}) {
  const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return slots
    .slice(0, count)
    .map((slot) => (
      <Skeleton
        key={slot}
        shape={
          startShort && slot === 1
            ? "heading"
            : slot % 3 === 0
              ? "short"
              : "line"
        }
      />
    ));
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="ui-skeleton-panel">{children}</div>;
}

function PageShape({ page }: { page: Page }) {
  switch (page) {
    case "shelf":
      return (
        <div className="shelf-grid ui-skeleton-shelf">
          {[1, 2, 3, 4, 5, 6].map((slot) => (
            <div className="ui-skeleton-stack" key={slot}>
              <Skeleton shape="cover" />
              <Skeleton shape="heading" />
              <Skeleton shape="short" />
            </div>
          ))}
        </div>
      );
    case "overview":
      return (
        <div className="overview-columns">
          <div className="ui-skeleton-stack">
            <Panel>
              <Lines count={9} startShort />
            </Panel>
            <Panel>
              <Lines count={4} startShort />
            </Panel>
          </div>
          <div className="ui-skeleton-stack">
            <Panel>
              <Lines count={4} startShort />
            </Panel>
            <Panel>
              <Lines count={3} startShort />
            </Panel>
          </div>
        </div>
      );
    case "ideation":
      return (
        <div className="ideation-desk ui-skeleton-ideation">
          <Panel>
            <Skeleton shape="heading" />
            <Skeleton shape="field" />
            <Skeleton shape="field" />
          </Panel>
          <Panel>
            <Skeleton shape="heading" />
            <Lines count={4} />
            <Skeleton shape="block" />
          </Panel>
          <Panel>
            <Skeleton shape="heading" />
            <Skeleton shape="field" />
            <Skeleton shape="field" />
            <Skeleton shape="field" />
          </Panel>
        </div>
      );
    case "chapter":
      return (
        <div className="ui-skeleton-stack">
          <Skeleton shape="heading" />
          <div className="ui-skeleton-role-chain">
            {[1, 2, 3, 4, 5, 6].map((role) => (
              <div className="ui-skeleton-role" key={role}>
                <Skeleton shape="circle" />
                <Skeleton shape="short" />
              </div>
            ))}
          </div>
          <div className="ui-skeleton-manuscript">
            <Panel>
              <Lines count={12} startShort />
            </Panel>
          </div>
        </div>
      );
    case "memory":
      return (
        <div className="ui-skeleton-stack">
          <Skeleton shape="heading" />
          <div className="ui-skeleton-memory-summary">
            {[1, 2, 3, 4].map((section) => (
              <Panel key={section}>
                <Lines count={2} startShort />
              </Panel>
            ))}
          </div>
          <div className="ui-skeleton-files">
            <Panel>
              <Lines count={6} startShort />
            </Panel>
            <Panel>
              <Lines count={10} startShort />
            </Panel>
          </div>
        </div>
      );
    case "files":
      return (
        <div className="ui-skeleton-files">
          <Panel>
            <Skeleton shape="field" />
            <Lines count={9} />
          </Panel>
          <Panel>
            <Lines count={11} startShort />
          </Panel>
        </div>
      );
    case "account":
      return (
        <div className="account-grid">
          <div className="ui-skeleton-stack">
            <Panel>
              <Skeleton shape="heading" />
              <Skeleton shape="field" />
              <Lines count={8} />
            </Panel>
            <Panel>
              <Lines count={3} startShort />
            </Panel>
          </div>
          <Panel>
            <Lines count={12} startShort />
          </Panel>
        </div>
      );
    case "signIn":
      return (
        <div className="ui-skeleton-stack">
          <Skeleton shape="heading" />
          <Skeleton shape="line" />
          <Skeleton shape="field" />
          <Skeleton shape="short" />
        </div>
      );
    case "text":
      return (
        <Panel>
          <Lines count={6} startShort />
        </Panel>
      );
  }
}

export function PageSkeleton({ page }: { page: Page }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => observeSlowLoad(window, () => setSlow(true)), []);
  return (
    <div className="ui-loading" data-testid="loading-skeleton" data-page={page}>
      {slow && (
        <div className="ui-loading-slow" data-testid="slow-load">
          <output>{c.slow}</output>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {c.refresh}
          </Button>
        </div>
      )}
      <section aria-busy="true" aria-label={c.pending[page]}>
        <div aria-hidden="true">
          <PageShape page={page} />
        </div>
      </section>
    </div>
  );
}
