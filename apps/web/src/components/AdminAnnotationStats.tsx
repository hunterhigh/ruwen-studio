"use client";
import type { AnnotationStatsRow } from "@ruwen/db";
import { useState } from "react";
import { annotationStatsCopy as copy, roleName } from "../copy/zh-CN.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

const roles = {
  reader: roleName["qinggan-duzhe"],
  editor: roleName["wenxue-bianji"],
  plot: roleName["qingjie-heyanyuan"],
  reality: roleName["xianshi-heyanyuan"],
};
const percent = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 1,
});
const rate = (count: number, total: number) =>
  total ? percent.format(count / total) : copy.noRate;

function StatsTable({ query }: { query: string }) {
  const { data, error } = useApi<AnnotationStatsRow[]>(
    `/api/admin/annotation-stats?${query}`,
  );
  if (error)
    return (
      <div role="alert">
        <SafeMarkdown plain content={error} />
      </div>
    );
  if (!data) return <output>{copy.loading}</output>;
  return (
    <table className="usage-table" aria-label={copy.title}>
      <thead>
        <tr>
          {[
            copy.role,
            copy.total,
            copy.accepted,
            copy.dismissed,
            copy.useful,
            copy.notUseful,
          ].map((label) => (
            <th key={label} scope="col">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(Object.keys(roles) as AnnotationStatsRow["kind"][]).map((kind) => {
          const row = data.find((item) => item.kind === kind);
          const total = row?.total ?? 0;
          const rated = (row?.useful ?? 0) + (row?.notUseful ?? 0);
          return (
            <tr key={kind}>
              <th scope="row">{roles[kind]}</th>
              <td>{total}</td>
              <td>{rate(row?.accepted ?? 0, total)}</td>
              <td>{rate(row?.dismissed ?? 0, total)}</td>
              <td>{rate(row?.useful ?? 0, rated)}</td>
              <td>{rate(row?.notUseful ?? 0, rated)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function AdminAnnotationStats() {
  const [initial] = useState(() => {
    const today = new Date();
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - 29);
    return {
      from: from.toISOString().slice(0, 10),
      to: today.toISOString().slice(0, 10),
    };
  });
  const [query, setQuery] = useState(() =>
    new URLSearchParams(initial).toString(),
  );
  return (
    <section className="paper-panel" aria-labelledby="annotation-stats-heading">
      <h2 id="annotation-stats-heading">{copy.title}</h2>
      <p>{copy.basis}</p>
      <form
        className="annotation-stats-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setQuery(
            new URLSearchParams({
              from: String(form.get("from")),
              to: String(form.get("to")),
            }).toString(),
          );
        }}
      >
        <label>
          {copy.from}{" "}
          <input type="date" name="from" required defaultValue={initial.from} />
        </label>
        <label>
          {copy.to}{" "}
          <input type="date" name="to" required defaultValue={initial.to} />
        </label>
        <button className="button" type="submit">
          {copy.filter}
        </button>
      </form>
      <div className="table-scroll">
        <StatsTable key={query} query={query} />
      </div>
    </section>
  );
}
