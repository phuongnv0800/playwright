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
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import { StubAIProvider } from "./stub-ai-provider.js";

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const fallback = new OpenAICompatibleProvider();
const stub = new StubAIProvider();

export class CodexAuthProvider implements AIProvider {
  readonly name = "codex-auth";

  private isConfigured(): boolean {
    return Boolean(env.CODEX_AUTH_BASE_URL && env.CODEX_AUTH_TOKEN && env.CODEX_AUTH_MODEL);
  }

  private async completeJson<T>(systemPrompt: string, input: unknown): Promise<T | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const response = await fetch(`${env.CODEX_AUTH_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.CODEX_AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        model: env.CODEX_AUTH_MODEL,
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
      "Return strict JSON with keys recipe, confidence, notes. Generate a generic Playwright source recipe.",
      input,
    );
    if (!parsed?.recipe) {
      return this.isConfigured() ? fallback.draftRecipe(input) : stub.draftRecipe(input);
    }
    return {
      recipe: parsed.recipe,
      confidence: parsed.confidence ?? 0.5,
      notes: parsed.notes,
    };
  }

  async planDiscovery(input: DiscoveryPlanInput): Promise<DiscoveryPlanResult> {
    const parsed = await this.completeJson<DiscoveryPlanResult>(
      "Return strict JSON with keys recipe, confidence, notes. Build a fail-safe URL-discovery crawl recipe.",
      input,
    );
    if (parsed) {
      return parsed;
    }
    return this.isConfigured() ? fallback.planDiscovery(input) : stub.planDiscovery(input);
  }

  async classifyPage(input: PageClassificationInput): Promise<PageClassificationResult> {
    const parsed = await this.completeJson<PageClassificationResult>(
      "Return strict JSON with keys pageKind, confidence, notes. pageKind must be one of seed, list, detail, login, oauth-callback, other.",
      input,
    );
    if (parsed) {
      return parsed;
    }
    return this.isConfigured() ? fallback.classifyPage(input) : stub.classifyPage(input);
  }

  async inferSchema(input: SchemaInferenceInput): Promise<SchemaInferenceResult> {
    const parsed = await this.completeJson<SchemaInferenceResult>(
      "Return strict JSON with keys fields, confidence, notes.",
      input,
    );
    if (parsed) {
      return parsed;
    }
    return this.isConfigured() ? fallback.inferSchema(input) : stub.inferSchema(input);
  }

  async inferEntityType(input: EntityInferenceInput): Promise<EntityInferenceResult> {
    const parsed = await this.completeJson<EntityInferenceResult>(
      "Return strict JSON with keys entityType, confidence, notes. entityType must be Document, Task, or Record.",
      input,
    );
    if (parsed) {
      return parsed;
    }
    return this.isConfigured() ? fallback.inferEntityType(input) : stub.inferEntityType(input);
  }

  async repairRecipe(input: RepairRecipeInput): Promise<DiscoveryPlanResult> {
    const parsed = await this.completeJson<DiscoveryPlanResult>(
      "Return strict JSON with keys recipe, confidence, notes. Repair the provided crawl recipe.",
      input,
    );
    if (parsed) {
      return parsed;
    }
    return this.isConfigured() ? fallback.repairRecipe(input) : stub.repairRecipe(input);
  }
}
