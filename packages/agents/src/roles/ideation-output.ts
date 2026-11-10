import { arr, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
export const ideationSectionPatches = arr(
  obj({
    path: str({ minLength: 1, maxLength: 300 }),
    base_sha256: str({ pattern: "^[a-f0-9]{64}$" }),
    sections: arr(
      obj({
        heading: str({ minLength: 1, maxLength: 200 }),
        replacement: str({ maxLength: 4000 }),
      }),
      { minItems: 1, maxItems: 8 },
    ),
  }),
  { maxItems: 32 },
);
export const ideationNewFiles = opt(
  arr(
    obj({
      resource_id: str({ pattern: "^[a-z0-9-]{2,64}$" }),
      path: str({ minLength: 1, maxLength: 300 }),
      type: oneOf(["governance", "character", "world", "story", "validation"]),
      content: str({ minLength: 1, maxLength: 16000 }),
    }),
    { maxItems: 8 },
  ),
);
