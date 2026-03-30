import { describe, expect, it } from "vitest";

import { buildBootstrapAuthRecipe, shouldBootstrapAuthentication } from "../src/services/url-crawl-service.js";
import type { CrawlAuthInput, PageHeuristicProfile, SiteDefinition } from "../src/types.js";

const site: SiteDefinition = {
  id: "site_fixture",
  slug: "fixture",
  name: "Fixture",
  baseUrl: "https://eoffice.vnpt.vn",
  objective: "Protected crawl",
  entityType: "Record",
  fieldList: ["title", "url", "summary", "content"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function buildProfile(overrides: Partial<PageHeuristicProfile> = {}): PageHeuristicProfile {
  return {
    url: "https://id.vnpt.com.vn/cas/login?service=https%3A%2F%2Feoffice.vnpt.vn%2Fqlvbdh%2Fmain",
    title: "VNPT | CAS – Central Authentication Service",
    textExcerpt: "Ten dang nhap Mat khau Dang nhap",
    textLength: 120,
    htmlExcerpt: "<form><input type='text'><input type='password'></form>",
    hasPasswordForm: true,
    forms: [
      {
        selector: "#fm1",
        action: "/cas/login",
        method: "post",
        hasPassword: true,
        inputs: [
          {
            selector: "#username",
            type: "text",
            name: "username",
            placeholder: "Ten dang nhap",
          },
          {
            selector: "#password",
            type: "password",
            name: "password",
            placeholder: "Mat khau",
          },
        ],
      },
    ],
    links: [],
    repeatedGroups: [],
    candidateContentSelector: "body",
    candidateTitleSelector: "title",
    networkRequests: [],
    ...overrides,
  };
}

describe("url crawl bootstrap auth helpers", () => {
  it("requires pre-auth discovery when the seed resolves to a CAS login page", () => {
    const authConfig: CrawlAuthInput = {
      mode: "auto",
      credentials: {
        username: "demo",
        password: "secret",
      },
    };

    const profile = buildProfile();

    expect(shouldBootstrapAuthentication("https://eoffice.vnpt.vn/qlvbdh/main", authConfig, profile)).toBe(true);

    const recipe = buildBootstrapAuthRecipe(site, "https://eoffice.vnpt.vn/qlvbdh/main", authConfig, profile);
    expect(recipe.autoDiscovery?.authStrategy.mode).toBe("form");
    expect(recipe.autoDiscovery?.authStrategy.loginUrl).toBe(profile.url);
    expect(recipe.autoDiscovery?.authStrategy.successUrlContains).toBe("/qlvbdh/main");
  });

  it("does not pre-auth when auth mode is none", () => {
    const authConfig: CrawlAuthInput = {
      mode: "none",
    };

    expect(shouldBootstrapAuthentication("https://example.com/list", authConfig, buildProfile())).toBe(false);
  });
});
