import { renderTemplate } from "../../lib/template.js";
import type { SinkConnector, SinkConnectorPayload, SinkConnectorResult } from "../../types.js";

export class EchoSinkConnector implements SinkConnector {
  readonly type = "echo";

  async test(config: Record<string, unknown>, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      ok: true,
      sinkType: this.type,
      config,
      payload,
    };
  }

  async deliver(payload: SinkConnectorPayload): Promise<SinkConnectorResult> {
    const rendered = renderTemplate(payload.template.template, {
      entity: payload.entity,
      site: payload.site,
      sink: payload.sink,
    });

    return {
      status: "succeeded",
      responsePayload: {
        accepted: true,
        rendered,
      },
    };
  }
}
