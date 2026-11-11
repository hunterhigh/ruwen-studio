const target = process.argv[2];
if (target !== "web" && target !== "worker") process.exit(1);
const port =
  target === "web"
    ? (process.env.PORT ?? "8080")
    : (process.env.HEALTH_PORT ?? "8081");
try {
  const response = await fetch(
    `http://127.0.0.1:${port}/${target === "web" ? "api/health" : "health"}`,
    {
      signal: AbortSignal.timeout(3000),
    },
  );
  process.exitCode = response.ok ? 0 : 1;
} catch {
  process.exitCode = 1;
}
