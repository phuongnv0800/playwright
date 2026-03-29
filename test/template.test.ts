import { describe, expect, it } from "vitest";

import { renderTemplate } from "../src/lib/template.js";

describe("renderTemplate", () => {
  it("renders nested placeholders and preserves object values", () => {
    const payload = renderTemplate(
      {
        id: "{{entity.externalId}}",
        meta: "{{entity.data}}",
        label: "site={{site.slug}}",
      },
      {
        entity: {
          externalId: "DOC-001",
          data: {
            title: "Alpha",
          },
        },
        site: {
          slug: "fixture",
        },
      },
    );

    expect(payload).toEqual({
      id: "DOC-001",
      meta: {
        title: "Alpha",
      },
      label: "site=fixture",
    });
  });
});
