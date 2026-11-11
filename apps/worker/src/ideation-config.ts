import {
  COORDINATOR_RECORDING_FORMAT,
  TavilySearchProvider,
} from "@ruwen/agents";
/** Shared by the HTTP producer and queue consumer; never populated from a client request. */
export function configuredIdeation(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...(["record", "replay"].includes(env.MODEL_MODE ?? "")
      ? { coordinatorRecordingFormat: COORDINATOR_RECORDING_FORMAT }
      : {}),
    ...(env.SEARCH_PROVIDER === "tavily" && env.SEARCH_API_KEY
      ? { search: new TavilySearchProvider(env.SEARCH_API_KEY) }
      : {}),
  };
}
