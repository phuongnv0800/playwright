import type {
  AIProvider,
  AIRecipeDraftInput,
  DiscoveryPlanInput,
  DiscoveryPlanResult,
  EntityInferenceInput,
  EntityInferenceResult,
  PageClassificationInput,
  PageClassificationResult,
  RepairRecipeInput,
  SchemaInferenceInput,
  SchemaInferenceResult,
  SourceRecipe,
} from "../../types.js";

import { env } from "../../config/env.js";
import { StubAIProvider } from "./stub-ai-provider.js";

const fallback = new StubAIProvider();

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai-compatible";

  private isConfigured(): boolean {
    return Boolean(env.AI_BASE_URL && env.AI_API_KEY && env.AI_MODEL);
  }

  private async completeJson<T>(systemPrompt: string, input: unknown): Promise<T | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const response = await fetch(`${env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
        response_format: {
          type: "json_object",
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ChatCompletionPayload;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }

    try {
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async draftRecipe(input: AIRecipeDraftInput): Promise<{ recipe: SourceRecipe; confidence: number; notes?: string }> {
    const parsed = await this.completeJson<{
      recipe?: SourceRecipe;
      confidence?: number;
      notes?: string;
    }>(
      "You generate JSON recipes for a generic Playwright source connector. Return strict JSON with keys: recipe, confidence, notes.",
      input,
    );

    if (!parsed?.recipe) {
      return fallback.draftRecipe(input);
    }

    return {
      recipe: parsed.recipe,
      confidence: parsed.confidence ?? 0.5,
      notes: parsed.notes,
    };
  }

  async planDiscovery(input: DiscoveryPlanInput): Promise<DiscoveryPlanResult> {
    const parsed = await this.completeJson<DiscoveryPlanResult>(
      "Return strict JSON with keys recipe, confidence, notes. Build a URL-discovery crawl recipe from the provided page profiles. Prefer fail-safe, same-origin mini-crawl rules, and include authStrategy/pageKinds/navigation/verification.",
      input,
    );

    return parsed ?? fallback.planDiscovery(input);
  }

  async classifyPage(input: PageClassificationInput): Promise<PageClassificationResult> {
    const parsed = await this.completeJson<PageClassificationResult>(
      "Return strict JSON with keys pageKind, confidence, notes. pageKind must be one of seed, list, detail, login, oauth-callback, other.",
      input,
    );

    return parsed ?? fallback.classifyPage(input);
  }

  async inferSchema(input: SchemaInferenceInput): Promise<SchemaInferenceResult> {
    const parsed = await this.completeJson<SchemaInferenceResult>(
      "Return strict JSON with keys fields, confidence, notes. fields must be a concise array of schema field names for normalized records.",
      input,
    );

    return parsed ?? fallback.inferSchema(input);
  }

  async inferEntityType(input: EntityInferenceInput): Promise<EntityInferenceResult> {
    const parsed = await this.completeJson<EntityInferenceResult>(
      "Return strict JSON with keys entityType, confidence, notes. entityType must be one of Document, Task, Record.",
      input,
    );

    return parsed ?? fallback.inferEntityType(input);
  }

  async repairRecipe(input: RepairRecipeInput): Promise<DiscoveryPlanResult> {
    const parsed = await this.completeJson<DiscoveryPlanResult>(
      "Return strict JSON with keys recipe, confidence, notes. Repair the provided URL-discovery recipe after the reported crawl failure.",
      input,
    );

    return parsed ?? fallback.repairRecipe(input);
  }
}
