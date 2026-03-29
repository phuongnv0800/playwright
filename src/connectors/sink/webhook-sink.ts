import { renderTemplate } from "../../lib/template.js";
import type { SinkConnector, SinkConnectorPayload, SinkConnectorResult } from "../../types.js";

export class WebhookSinkConnector implements SinkConnector {
  readonly type = "webhook";

  async test(config: Record<string, unknown>, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const endpoint = String(config.endpoint ?? "");
    if (!endpoint) {
      throw new Error("Webhook endpoint is required");
    }

    const response = await fetch(endpoint, {
      method: String(config.method ?? "POST"),
      headers: {
        "content-type": "application/json",
        ...(config.headers as Record<string, string> | undefined),
      },
      body: JSON.stringify(payload),
    });

    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  }

  async deliver(payload: SinkConnectorPayload): Promise<SinkConnectorResult> {
    const endpoint = String(payload.sink.config.endpoint ?? "");
    if (!endpoint) {
      return {
        status: "failed",
        responsePayload: {},
        error: "Webhook endpoint is required",
      };
    }

    const body = renderTemplate(payload.template.template, {
      entity: payload.entity,
      site: payload.site,
      sink: payload.sink,
    });

    const response = await fetch(endpoint, {
      method: String(payload.sink.config.method ?? "POST"),
      headers: {
        "content-type": "application/json",
        ...(payload.sink.config.headers as Record<string, string> | undefined),
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();

    return {
      status: response.ok ? "succeeded" : "failed",
      responsePayload: {
        status: response.status,
        body: responseText,
      },
      error: response.ok ? undefined : `Webhook delivery failed with status ${response.status}`,
    };
  }
}
