import { SafeMarkdown } from "../components/SafeMarkdown.tsx";
import {
  changeKind,
  editorDecision,
  fieldName,
  kindNames,
  previewStatus,
  readerReaction,
  roleName,
  runStatus,
  taskStatus,
  uiCopy,
} from "../copy/zh-CN.ts";

const valueNames: Record<string, string> = {
  ...readerReaction,
  ...editorDecision,
  ...changeKind,
  ...kindNames,
  ...roleName,
  ...previewStatus,
  ...taskStatus,
  ...runStatus,
};
function scalar(value: unknown, field: string) {
  if (value === null || value === undefined || value === "")
    return uiCopy.empty;
  if (typeof value === "boolean") return value ? uiCopy.yes : uiCopy.no;
  if (typeof value === "number") return value.toLocaleString("zh-CN");
  if (typeof value !== "string") return uiCopy.unknownValue;
  if (Object.hasOwn(valueNames, value))
    return valueNames[value] ?? uiCopy.unknownValue;
  return ["status", "role", "kind", "decision", "type"].includes(field)
    ? uiCopy.unknownValue
    : value;
}
function Content({
  value,
  field = "",
  depth = 0,
  ancestors = new Set<unknown>(),
}: {
  value: unknown;
  field?: string;
  depth?: number;
  ancestors?: Set<unknown>;
}) {
  if (value === null || typeof value !== "object")
    return <SafeMarkdown plain content={scalar(value, field)} />;
  if (ancestors.has(value)) return <p>{uiCopy.circular}</p>;
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (!value.length) return <p>{uiCopy.empty}</p>;
    const items = value.map((item, index) => ({
      id: `item-${depth}-${index}`,
      item,
    }));
    return (
      <ul>
        {items.map(({ id, item }) => (
          <li key={id}>
            <Content
              value={item}
              field={field}
              depth={depth + 1}
              ancestors={next}
            />
          </li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(value);
  const known = entries.filter(([key]) => Object.hasOwn(fieldName, key));
  const unknown = entries.filter(([key]) => !Object.hasOwn(fieldName, key));
  if (!entries.length) return <p>{uiCopy.empty}</p>;
  return (
    <>
      {known.length > 0 && (
        <dl>
          {known.map(([key, item]) => (
            <div key={key}>
              <dt>{fieldName[key]}</dt>
              <dd>
                <Content
                  value={item}
                  field={key}
                  depth={depth + 1}
                  ancestors={next}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {unknown.length > 0 && (
        <details>
          <summary>{uiCopy.other}</summary>
          <ul>
            {unknown.map(([key, item]) => (
              <li key={key}>
                <Content value={item} depth={depth + 1} ancestors={next} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
export function KeyValueList({ value }: { value: unknown }) {
  return (
    <div className="ui-key-values">
      <Content value={value} />
    </div>
  );
}
