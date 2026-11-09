/** Development defaults from SECURITY-DESIGN; deployments override using environment only. */
export function securityLimits(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const positive = (name: string, fallback: number) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid security limit: ${name}`);
    return value;
  };
  return {
    chatChars: positive("RUWEN_CHAT_MAX_CHARS", 8000),
    materialChars: positive("RUWEN_MATERIAL_MAX_CHARS", 100_000),
    inputChars: positive("RUWEN_INPUT_MAX_CHARS", 1_000_000),
    jsonDepth: positive("RUWEN_JSON_MAX_DEPTH", 32),
    jsonNodes: positive("RUWEN_JSON_MAX_NODES", 50_000),
    archiveDepth: positive("RUWEN_ARCHIVE_MAX_DEPTH", 32),
    archiveRatio: positive("RUWEN_ARCHIVE_MAX_RATIO", 200),
  };
}
