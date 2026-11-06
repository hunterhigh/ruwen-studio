import type { Data, SearchProvider } from "../types.ts";

/** Official endpoint: https://docs.tavily.com/documentation/api-reference/endpoint/search */
export class TavilySearchProvider implements SearchProvider {
  private readonly key: string;
  private readonly request: typeof fetch;
  constructor(key: string, request = fetch) {
    if (!key.trim()) throw new Error("Search API key is not configured");
    this.key = key;
    this.request = request;
  }
  async search(query: string, signal?: AbortSignal): Promise<Data[]> {
    const timeout = AbortSignal.timeout(30_000);
    const response = await this.request("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok)
      throw new Error(`Search provider failed (${response.status})`);
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== "object" ||
      !("results" in value) ||
      !Array.isArray(value.results)
    )
      throw new Error("Invalid search response");
    return value.results.slice(0, 5).map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.url !== "string" ||
        typeof item.title !== "string" ||
        typeof item.content !== "string" ||
        !/^https?:\/\//.test(item.url)
      )
        throw new Error("Invalid search result");
      return {
        title: Array.from(item.title).slice(0, 300).join(""),
        url: item.url,
        content: Array.from(item.content).slice(0, 2000).join(""),
      };
    });
  }
}
