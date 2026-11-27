import { randomBytes } from "node:crypto";
import { previewConfiguration } from "../../../config/preview.ts";
import { getServices } from "../src/server/services.ts";

const preview = previewConfiguration();
if (
  process.env.BETTER_AUTH_URL !== preview.baseUrl ||
  process.env.DATABASE_URL !== preview.databaseUrl ||
  process.env.MODEL_MODE !== "faux" ||
  process.env.REAL_MODEL !== "0" ||
  process.env.PAYMENT_PROVIDER !== "mock" ||
  process.env.REAL_CHARGING_ENABLED !== "0" ||
  process.env.LOCAL_PREVIEW !== "1" ||
  !process.argv.includes("--preview-tls")
) {
  throw new Error("The browser fixture requires the local faux preview");
}

// Seed the same loopback-only test services as the development preview.
// The regular server then loads the existing production build with strict CSP.
process.env.RUWEN_IP_PROOF_SECRET ??= randomBytes(32).toString("hex");
Reflect.set(process.env, "NODE_ENV", "test");
await getServices();
await import("../scripts/server.ts");
// The Next server has selected its production build. Only this disposable
// process uses test runtime settings for faux simulations and mock checkout.
Reflect.set(process.env, "NODE_ENV", "test");
