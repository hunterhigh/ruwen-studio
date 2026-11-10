/** Next's Node startup path also covers direct Next CLI use, before the first request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { deploymentCanary } = await import("@ruwen/agents");
    deploymentCanary();
  }
}
