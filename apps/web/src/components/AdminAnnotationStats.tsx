"use client";
import type { AnnotationStatsRow } from "@ruwen/db";
import { useState } from "react";
import {
  adminCopy,
  annotationStatsCopy as copy,
  roleName,
} from "../copy/zh-CN.ts";
import { Button } from "../ui/Button.tsx";
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
  const { data, error, refresh } = useApi<AnnotationStatsRow[]>(
    `/api/admin/annotation-stats?${query}`,
  );
  if (error)
    return (
      <div className="admin-error">
        <p role="alert">{adminCopy.errors.stats}</p>
        <Button variant="ghost" onClick={() => void refresh()}>
          {adminCopy.reload}
        </Button>
      </div>
    );
  if (!data) return <output>{copy.loading}</output>;
  return (
    <table className="admin-table" aria-label={copy.title}>
      <thead>
        <tr>
          {[
            copy.role,
            copy.total,
            copy.accepted,
            copy.dismissed,
            copy.useful,
            copy.notUseful,
          ].map((label, index) => (
            <th
              key={label}
              scope="col"
              className={index > 0 ? "admin-number" : undefined}
            >
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
              <td className="admin-number">{total.toLocaleString("zh-CN")}</td>
              <td className="admin-number">
                {rate(row?.accepted ?? 0, total)}
              </td>
              <td className="admin-number">
                {rate(row?.dismissed ?? 0, total)}
              </td>
              <td className="admin-number">{rate(row?.useful ?? 0, rated)}</td>
              <td className="admin-number">
                {rate(row?.notUseful ?? 0, rated)}
              </td>
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
  const [invalidDates, setInvalidDates] = useState(false);
  return (
    <section
      className="paper-panel admin-panel"
      aria-labelledby="annotation-stats-heading"
    >
      <h2 id="annotation-stats-heading">{copy.title}</h2>
      <p>{copy.basis}</p>
      <form
        className="annotation-stats-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const from = String(form.get("from"));
          const to = String(form.get("to"));
          setInvalidDates(from > to);
          if (from <= to)
            setQuery(new URLSearchParams({ from, to }).toString());
        }}
      >
        <label>
          {copy.from}{" "}
          <input
            className="admin-number"
            type="date"
            name="from"
            required
            defaultValue={initial.from}
          />
        </label>
        <label>
          {copy.to}{" "}
          <input
            className="admin-number"
            type="date"
            name="to"
            required
            defaultValue={initial.to}
          />
        </label>
        <Button type="submit">{copy.filter}</Button>
      </form>
      {invalidDates && (
        <p className="admin-error" role="alert">
          {adminCopy.errors.dateRange}
        </p>
      )}
      <div className="table-scroll">
        <StatsTable key={query} query={query} />
      </div>
    </section>
  );
}
