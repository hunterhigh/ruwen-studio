import { BillingError } from "@ruwen/billing";
import type { Database } from "@ruwen/db";
import { PostgresFS, TenantAccessError } from "@ruwen/db";
import { withIdeationV1_2 } from "../../../packages/pipeline/src/ideation/service-v1-2.ts";
import {
  IdeationFailure,
  type IdeationSessionOptions,
} from "../../../packages/pipeline/src/ideation/sessions.ts";
import { IdeationServiceBackend } from "../../../packages/pipeline/src/ideation/specialized.ts";
import { withIdeationBilling } from "./ideation-billing.ts";

/** Web uses an authenticated actor. No actor identity is ever accepted from a JSON body. */
export function createIdeationService(
  db: Database,
  options: IdeationSessionOptions,
) {
  return new IdeationServiceBackend(
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

/** Opt in to the merged v1.2 contract; v1.1 consumers keep their existing preview union. */
export function createIdeationServiceV1_2(
  db: Database,
  options: IdeationSessionOptions,
) {
  return withIdeationV1_2(createIdeationService(db, options));
}
