import type {
  AIProvider,
  AIRecipeDraftInput,
  AutoDiscoveryAuthStrategy,
  CrawlPageKind,
  DiscoveryPlanInput,
  DiscoveryPlanResult,
  EntityInferenceInput,
  EntityInferenceResult,
  PageClassificationInput,
  PageClassificationResult,
  PageHeuristicProfile,
  RepairRecipeInput,
  SchemaInferenceInput,
  SchemaInferenceResult,
  SourceRecipe,
} from "../../types.js";

function pickExternalIdField(fieldList: string[]): string | undefined {
  return fieldList.find((field) => /(^id$|code|number|documentId|recordId)/i.test(field));
}

function pickTitleField(fieldList: string[]): string | undefined {
  return fieldList.find((field) => /(title|name|subject|summary)/i.test(field)) ?? fieldList[0];
}

function urlPathParts(url: string): string[] {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function inferAuthStrategy(profile: PageHeuristicProfile, explicitMode: DiscoveryPlanInput["auth"]["mode"]): AutoDiscoveryAuthStrategy {
  if (explicitMode === "none") {
    return {
      mode: "none",
    };
  }

  if (explicitMode === "form") {
    const form = profile.forms.find((candidate) => candidate.hasPassword);
    return {
      mode: "form",
      usernameSelector: form?.inputs.find((input) => /email|text/i.test(input.type))?.selector,
      passwordSelector: form?.inputs.find((input) => /password/i.test(input.type))?.selector,
      submitSelector: "button[type='submit'], input[type='submit'], button",
    };
  }

  if (explicitMode === "oauth") {
    return {
      mode: "oauth",
      oauthTriggerTexts: ["sign in", "login", "continue with google", "continue with microsoft"],
    };
  }

  const oauthLink = profile.links.find((link) => /(google|microsoft|oauth|sso|continue with)/i.test(link.text));
  if (oauthLink) {
    return {
      mode: "oauth",
      oauthTriggerTexts: [oauthLink.text],
    };
  }

  const form = profile.forms.find((candidate) => candidate.hasPassword);
  if (form || profile.hasPasswordForm) {
    return {
      mode: "form",
      usernameSelector: form?.inputs.find((input) => /email|text/i.test(input.type))?.selector,
      passwordSelector: form?.inputs.find((input) => /password/i.test(input.type))?.selector,
      submitSelector: "button[type='submit'], input[type='submit'], button",
    };
  }

  return {
    mode: "none",
  };
}

function classifyProfile(profile: PageHeuristicProfile): PageClassificationResult {
  if (profile.hasPasswordForm) {
    return {
      pageKind: "login",
      confidence: 0.95,
      notes: "Password form detected on page.",
    };
  }

  const strongestGroup = [...profile.repeatedGroups].sort((left, right) => right.count - left.count)[0];
  if (strongestGroup && strongestGroup.count >= 3) {
    return {
      pageKind: "list",
      confidence: Math.min(0.98, 0.62 + strongestGroup.count / 20),
      notes: "Repeated items indicate a list or collection page.",
    };
  }

  const parts = urlPathParts(profile.url);
  if (profile.textLength > 500 || parts.length >= 2) {
    return {
      pageKind: "detail",
      confidence: profile.textLength > 500 ? 0.78 : 0.65,
      notes: "High text density or deep path indicates a detail page.",
    };
  }

  return {
    pageKind: "other",
    confidence: 0.45,
    notes: "No strong list/detail signal found.",
  };
}

function inferEntityFromProfiles(input: EntityInferenceInput): EntityInferenceResult {
  const combined = [
    input.seedProfile.title,
    input.seedProfile.textExcerpt,
    ...input.sampleProfiles.map((profile) => `${profile.title}\n${profile.textExcerpt}`),
  ]
    .join("\n")
    .toLowerCase();

  if (/(task|todo|assignment|ticket|issue|deadline|owner)/i.test(combined)) {
    return {
      entityType: "Task",
      confidence: 0.82,
      notes: "Task-like keywords detected in the content.",
    };
  }

  if (/(document|article|notice|announcement|report|policy|memo|invoice|reading)/i.test(combined)) {
    return {
      entityType: "Document",
      confidence: 0.78,
      notes: "Document-like wording detected.",
    };
  }

  return {
    entityType: "Record",
    confidence: 0.64,
    notes: "Defaulted to Record because no specific document/task pattern dominated.",
  };
}

function inferFieldNames(samples: Array<Record<string, unknown>>): string[] {
  const candidates = new Set<string>();
  for (const sample of samples) {
    for (const key of Object.keys(sample)) {
      if (key.trim().length > 0) {
        candidates.add(key);
      }
    }
  }

  const fields = [...candidates];
  if (fields.length === 0) {
    return ["title", "url", "summary", "content"];
  }

  return fields;
}

function buildAutoDiscoveryRecipe(input: DiscoveryPlanInput): DiscoveryPlanResult {
  const classification = classifyProfile(input.seedProfile);
  const entity = inferEntityFromProfiles({
    seedUrl: input.seedUrl,
    seedProfile: input.seedProfile,
    sampleProfiles: input.sampleProfiles,
  });
  const strongestGroup = [...input.seedProfile.repeatedGroups].sort((left, right) => right.count - left.count)[0];
  const authStrategy = inferAuthStrategy(input.seedProfile, input.auth.mode);
  const sampleUrls = [
    input.seedProfile.url,
    ...input.sampleProfiles.map((profile) => profile.url),
  ].slice(0, 3);

  const fields = ["title", "url", "summary", "content"];
  const recipe: SourceRecipe = {
    version: 1,
    connectorType: "url-discovery",
    entryUrl: input.seedUrl,
    authRequired: authStrategy.mode !== "none",
    autoDiscovery: {
      entityType: entity.entityType,
      fields,
      authStrategy,
      pageKinds: [
        {
          kind: "seed",
          pageSelector: "body",
          confidence: 1,
        },
        {
          kind: classification.pageKind,
          itemSelector: strongestGroup?.itemSelector,
          detailLinkSelector: strongestGroup?.sampleHrefs.length ? "a[href]" : undefined,
          titleSelector: "h1, h2, h3, a[href]",
          summarySelector: "p, span",
          contentSelector: input.seedProfile.candidateContentSelector ?? "main, article, body",
          confidence: classification.confidence,
        },
        {
          kind: "detail",
          titleSelector: input.seedProfile.candidateTitleSelector ?? "h1, h2, title",
          contentSelector: input.seedProfile.candidateContentSelector ?? "main, article, body",
          confidence: 0.7,
        },
      ],
      navigation: {
        sameOriginOnly: input.crawl.sameOriginOnly,
        maxDepth: input.crawl.maxDepth,
        maxPages: input.crawl.maxPages,
        maxRecords: input.crawl.maxRecords,
        allowPatterns: ["^https?://"],
        denyPatterns: [
          "logout",
          "signout",
          "delete",
          "remove",
          "mailto:",
          "tel:",
          "\\.pdf$",
          "\\.zip$",
        ],
      },
      verification: {
        sampleUrls,
        artifacts: ["seed-profile", "sample-profiles"],
        notes: "Recipe generated by deterministic heuristic provider.",
      },
    },
    notes: "Auto-discovery recipe generated by heuristic fallback provider.",
  };

  return {
    recipe,
    confidence: Number(((classification.confidence + entity.confidence) / 2).toFixed(2)),
    notes: [classification.notes, entity.notes].filter(Boolean).join(" "),
  };
}

export class StubAIProvider implements AIProvider {
  readonly name = "stub";

  async draftRecipe(input: AIRecipeDraftInput): Promise<{ recipe: SourceRecipe; confidence: number; notes?: string }> {
    const { site, account } = input;
    const lowerFields = site.fieldList.map((field) => field.trim());

    const recipe: SourceRecipe = {
      version: 1,
      connectorType: "generic-recipe",
      entryUrl: site.baseUrl,
      authRequired: account?.authMode !== "none",
      login:
        account?.authMode === "none"
          ? undefined
          : {
              loginUrl: `${site.baseUrl.replace(/\/$/, "")}/login`,
              usernameSelector: '[data-field="username"], input[name="username"], input[type="email"]',
              passwordSelector: '[data-field="password"], input[name="password"], input[type="password"]',
              submitSelector: 'button[type="submit"], [data-action="submit"]',
              successSelector: '[data-authenticated="true"], [data-page="records"]',
            },
      discovery: {
        listUrl: `${site.baseUrl.replace(/\/$/, "")}/records`,
        waitForSelector: "[data-record]",
        listItemSelector: "[data-record]",
        fields: lowerFields.map((field) => ({
          name: field,
          selector: `[data-field="${field}"]`,
          required: true,
          scope: "item",
        })),
      },
      normalization: {
        externalIdField: pickExternalIdField(site.fieldList),
        titleField: pickTitleField(site.fieldList),
      },
      notes:
        "Draft recipe generated from field list. Review selectors before publishing for real sites that do not expose stable data-field attributes.",
    };

    return {
      recipe,
      confidence: 0.62,
      notes: recipe.notes,
    };
  }

  async planDiscovery(input: DiscoveryPlanInput): Promise<DiscoveryPlanResult> {
    return buildAutoDiscoveryRecipe(input);
  }

  async classifyPage(input: PageClassificationInput): Promise<PageClassificationResult> {
    const direct = classifyProfile(input.profile);
    const listDefinition = input.recipe.autoDiscovery?.pageKinds.find((page) => page.kind === "list");
    const detailDefinition = input.recipe.autoDiscovery?.pageKinds.find((page) => page.kind === "detail");

    if (listDefinition?.itemSelector) {
      const listConfidence = input.profile.repeatedGroups.some((candidate) => candidate.itemSelector === listDefinition.itemSelector)
        ? Math.max(direct.confidence, listDefinition.confidence)
        : direct.confidence;
      if (listConfidence >= 0.75) {
        return {
          pageKind: "list",
          confidence: listConfidence,
          notes: "Recipe selector matched repeated items on page.",
        };
      }
    }

    if (detailDefinition?.contentSelector && input.profile.textLength > 200) {
      return {
        pageKind: direct.pageKind === "other" ? "detail" : direct.pageKind,
        confidence: Math.max(direct.confidence, detailDefinition.confidence),
        notes: "Detail content density matched recipe expectations.",
      };
    }

    return direct;
  }

  async inferSchema(input: SchemaInferenceInput): Promise<SchemaInferenceResult> {
    const fields = inferFieldNames(input.samples);
    return {
      fields,
      confidence: fields.length > 0 ? 0.76 : 0.4,
      notes: "Schema inferred from extracted sample records.",
    };
  }

  async inferEntityType(input: EntityInferenceInput): Promise<EntityInferenceResult> {
    return inferEntityFromProfiles(input);
  }

  async repairRecipe(input: RepairRecipeInput): Promise<DiscoveryPlanResult> {
    const repaired = classifyProfile(input.failedProfile);
    const fallbackKind: CrawlPageKind = repaired.pageKind === "other" ? "detail" : repaired.pageKind;

    return {
      recipe: {
        ...input.recipe,
        connectorType: "url-discovery",
        autoDiscovery: input.recipe.autoDiscovery
          ? {
              ...input.recipe.autoDiscovery,
              pageKinds: input.recipe.autoDiscovery.pageKinds.map((page) =>
                page.kind === fallbackKind
                  ? {
                      ...page,
                      contentSelector: input.failedProfile.candidateContentSelector ?? page.contentSelector,
                      titleSelector: input.failedProfile.candidateTitleSelector ?? page.titleSelector,
                      confidence: Math.max(page.confidence, repaired.confidence),
                    }
                  : page,
              ),
              verification: {
                ...input.recipe.autoDiscovery.verification,
                notes: `Repaired after failure: ${input.failureReason}`,
              },
            }
          : undefined,
        notes: `Repaired recipe after failure: ${input.failureReason}`,
      },
      confidence: repaired.confidence,
      notes: repaired.notes,
    };
  }
}
