function getValue(path: string, context: Record<string, unknown>): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, context);
}

function renderString(template: string, context: Record<string, unknown>): unknown {
  const matches = [...template.matchAll(/\{\{([^}]+)\}\}/g)];

  if (matches.length === 0) {
    return template;
  }

  if (matches.length === 1 && matches[0]?.[0] === template) {
    return getValue(matches[0][1].trim(), context);
  }

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, token) => {
    const value = getValue(token.trim(), context);
    return value === undefined || value === null ? "" : String(value);
  });
}

export function renderTemplate<T>(template: T, context: Record<string, unknown>): T {
  if (Array.isArray(template)) {
    return template.map((value) => renderTemplate(value, context)) as T;
  }

  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template as Record<string, unknown>).map(([key, value]) => [
        key,
        renderTemplate(value, context),
      ]),
    ) as T;
  }

  if (typeof template === "string") {
    return renderString(template, context) as T;
  }

  return template;
}
