import { arr, bool, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
export const EXPRESSION_CHECKS = [
  "route",
  "fulfillment",
  "mapping",
  "anchoring",
  "density",
  "proximity",
] as const;
export const expressionReview = opt(
  arr(
    obj({
      category: oneOf(EXPRESSION_CHECKS),
      risk: oneOf(["low", "medium", "high"]),
      resolved: bool(),
      summary: str({ minLength: 1, maxLength: 600 }),
    }),
    { minItems: 6, maxItems: 6 },
  ),
);
