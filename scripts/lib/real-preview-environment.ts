import { randomBytes } from "node:crypto";
import path from "node:path";
import { realPreviewEnvironment } from "../../config/real-preview.ts";
import {
  assertModelCredentialFiles,
  processModelKey,
} from "../../packages/agents/src/runtime/model-credentials.ts";

/** Preflight/configuration only: never constructs a runtime or calls a provider. */
export function prepareRealPreviewEnvironment(root: string, faux: boolean) {
  assertModelCredentialFiles(root);
  // Next's dotenv directory is apps/web even though child CWD is the repository root.
  assertModelCredentialFiles(path.join(root, "apps/web"));
  if (!faux) processModelKey("deepseek");
  const env = realPreviewEnvironment(
    root,
    process.env,
    faux,
    randomBytes(48).toString("hex"),
    randomBytes(32).toString("hex"),
  );
  if (faux) delete env.DEEPSEEK_API_KEY;
  return env;
}
