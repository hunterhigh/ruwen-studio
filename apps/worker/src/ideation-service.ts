import { BillingError } from "@ruwen/billing";
import type { Database } from "@ruwen/db";
import { PostgresFS, TenantAccessError } from "@ruwen/db";
import {
  IdeationFailure,
  type IdeationSessionOptions,
} from "../../../packages/pipeline/src/ideation/sessions.ts";
import { IdeationWorkflow } from "../../../packages/pipeline/src/ideation/workflow.ts";
import { withIdeationBilling } from "./ideation-billing.ts";

/** Web uses an authenticated actor. No actor identity is ever accepted from a JSON body. */
export function createIdeationService(
  db: Database,
  options: IdeationSessionOptions,
) {
  return new IdeationWorkflow(
    {
      async transaction(actor, operation) {
        try {
          return await new PostgresFS(
            db,
            actor.projectId,
            actor.userId,
          ).transaction(operation);
        } catch (error) {
          if (error instanceof TenantAccessError)
            throw new IdeationFailure("NOT_FOUND");
          if (error instanceof BillingError)
            throw new IdeationFailure(error.code);
          throw error;
        }
      },
    },
    withIdeationBilling({
      ...options,
      externalSearch: Boolean(options.search),
    }),
  );
}
