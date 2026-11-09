"use client";
import { useCallback, useEffect, useState } from "react";
import { request } from "./client.ts";
export function useApi<T>(url: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const next = await request<T>(url);
      setData(next);
      setError("");
      return next;
    } catch (error) {
      setError((error as Error).message);
      return undefined;
    }
  }, [url]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { data, error, refresh };
}
