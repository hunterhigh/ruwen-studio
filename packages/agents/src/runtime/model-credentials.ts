import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const MODEL_KEY_ENV = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
} as const;
export const MODEL_KEY_NAMES = [
  ...Object.values(MODEL_KEY_ENV),
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "COHERE_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "CEREBRAS_API_KEY",
];
const names = new Set(MODEL_KEY_NAMES);
const defaultRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const forbidden = (name: string) =>
  names.has(name.toUpperCase()) ||
  (name.toUpperCase().endsWith("_FILE") &&
    names.has(name.toUpperCase().slice(0, -5)));
export class ModelCredentialError extends Error {}
const fileFailure = () =>
  new ModelCredentialError(
    "Model API keys must not be stored in configuration files. Remove the file credential and set a process environment variable instead.",
  );
function parseFile(file: string) {
  try {
    if (lstatSync(file).isSymbolicLink()) throw fileFailure();
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    throw fileFailure();
  }
}
function credentialObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([k, v]) =>
      ((forbidden(k) || /^(?:api_?key|access_?token)$/i.test(k)) &&
        typeof v === "string" &&
        v.trim().length > 0) ||
      credentialObject(v),
  );
}
/** No secret values, filenames or parser excerpts are included in failures. No disk-wide scan. */
export function assertModelCredentialFiles(
  root = process.env.RUWEN_WORKSPACE_ROOT ?? defaultRoot,
  extraFiles: readonly string[] = [],
) {
  const files = new Set(extraFiles.map((f) => path.resolve(f)));
  for (const dir of new Set([path.resolve(root), process.cwd()])) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir))
      if (
        /^\.env(?:\.[\w-]+)*$/.test(name) &&
        !/(?:\.example|\.sample|\.template)$/.test(name)
      )
        files.add(path.join(dir, name));
    const config = path.join(dir, "config");
    if (existsSync(config))
      for (const name of readdirSync(config))
        if (/^models?(?:[.-][\w-]+)*\.json$/.test(name)) {
          try {
            if (
              credentialObject(
                JSON.parse(readFileSync(path.join(config, name), "utf8")),
              )
            )
              throw fileFailure();
          } catch {
            throw fileFailure();
          }
        }
  }
  const argv = process.execArgv;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (/^--env-file(?:-if-exists)?=/.test(arg))
      files.add(path.resolve(arg.slice(arg.indexOf("=") + 1)));
    else if (/^--env-file(?:-if-exists)?$/.test(arg) && argv[i + 1])
      files.add(path.resolve(argv[++i] ?? ""));
  }
  for (const file of files)
    if (existsSync(file)) {
      const values = parseFile(file);
      if (Object.entries(values).some(([k, v]) => forbidden(k) && v?.trim()))
        throw fileFailure();
    }
  if (
    Object.entries(process.env).some(
      ([k, v]) => k.toUpperCase().endsWith("_FILE") && forbidden(k) && v,
    )
  )
    throw fileFailure();
}
/** Replaces native dotenv loading: only non-model settings, preserving parent environment priority. */
export function loadRuntimeEnvironment(
  options: { root?: string; file?: string; skipFile?: boolean } = {},
) {
  const root = options.root ?? defaultRoot,
    file = options.file ?? path.join(root, ".env");
  assertModelCredentialFiles(root, [file]);
  if (!options.skipFile && existsSync(file))
    for (const [k, v] of Object.entries(parseFile(file)))
      if (!forbidden(k) && process.env[k] === undefined) process.env[k] = v;
}
export function processModelKey(provider: string) {
  const name = MODEL_KEY_ENV[provider as keyof typeof MODEL_KEY_ENV];
  if (!name)
    throw new ModelCredentialError("Unsupported model credential provider");
  const key = process.env[name];
  if (!key || key !== key.trim())
    throw new ModelCredentialError(
      `Missing or invalid ${name}; set it in the current process environment only.`,
    );
  return key;
}
/** Captured only while a human process prepares a live request; never returned as diagnostics. */
export function processModelSecrets() {
  return [
    ...new Set(
      MODEL_KEY_NAMES.flatMap((name) => {
        const v = process.env[name];
        return v
          ? [v, encodeURIComponent(v), JSON.stringify(v).slice(1, -1)]
          : [];
      }),
    ),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}
export function redactModelValue<T>(value: T, secrets: readonly string[]): T {
  const text = (s: string) =>
    secrets.reduce((r, key) => r.split(key).join("[REDACTED]"), s);
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const result = Object.fromEntries(
        Object.entries(v).map(([k, x]) => [text(k), visit(x)]),
      );
      // Prevent a credential split over text blocks from being rejoined by a transcript renderer.
      if (Array.isArray(result.content)) {
        const blocks = result.content as { type?: string; text?: string }[];
        if (
          secrets.some((key) =>
            blocks
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("")
              .includes(key),
          )
        )
          result.content = blocks.map((b) =>
            b.type === "text"
              ? { ...b, text: "[REDACTED credential-bearing text]" }
              : b,
          );
      }
      return result;
    }
    return v;
  };
  return visit(value) as T;
}
