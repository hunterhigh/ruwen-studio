import { compile, type JsonSchema } from "@earendil-works/pi-schema";

export interface ToolValidationFailure {
  tool: string;
  issues: { path: string; keyword: string; message: string }[];
}

/** Explain the ORIGINAL arguments: SDK coercion must never silently satisfy the contract. */
export function toolValidator(schema: JsonSchema) {
  const validator = compile(schema),
    names = new Set<string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.properties && typeof record.properties === "object")
      for (const key of Object.keys(record.properties)) names.add(key);
    for (const child of Object.values(record)) collect(child);
  };
  collect(schema);
  return {
    check: validator.check,
    issues(value: unknown): ToolValidationFailure["issues"] {
      return validator
        .errors(value)
        .slice(0, 8)
        .map((error) => {
          // Paths come from the payload too. Keep only server-defined field names and bounded indices.
          const path = error.path
            .split("/")
            .slice(1)
            .map((part) => {
              const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
              return names.has(key) || /^(0|[1-9][0-9]{0,5})$/.test(key)
                ? part
                : "<unknown>";
            })
            .join("/");
          return {
            path: path ? `/${path}`.slice(0, 200) : "/",
            keyword: error.keyword,
            message: error.message.slice(0, 240),
          };
        });
    },
  };
}

export function toolValidationMessage(failure: ToolValidationFailure) {
  return `strict_schema_required: ${failure.tool}\n${failure.issues.map((e) => `${e.path}: ${e.message} (${e.keyword})`).join("\n")}`;
}
