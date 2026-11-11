/** Local preview/test coordinates. An isolated worktree uses its own ports and cluster directory. */
export function previewConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT ?? 3000);
  const databasePort = Number(env.PREVIEW_DATABASE_PORT ?? 54329);
  const productionPort = Number(env.PRODUCTION_TEST_PORT ?? port + 1);
  const databaseName = env.PREVIEW_DATABASE_NAME ?? "ruwen_dev";
  if (
    ![port, databasePort, productionPort].every(
      (value) => Number.isInteger(value) && value > 1023 && value < 65536,
    ) ||
    port === productionPort ||
    !/^ruwen_(?:dev|test[a-z0-9_]*)$/.test(databaseName)
  )
    throw new Error("Invalid isolated preview configuration");
  return {
    port,
    databasePort,
    databaseName,
    productionPort,
    baseUrl: `https://localhost:${port}`,
    productionUrl: `https://localhost:${productionPort}`,
    databaseUrl: `postgresql://ruwen:local_test_only@127.0.0.1:${databasePort}/${databaseName}`,
  };
}
