import type { Page } from "playwright";

import type { PageHeuristicProfile } from "../types.js";

export async function extractPageHeuristics(page: Page, networkRequests: string[]): Promise<PageHeuristicProfile> {
  const profile = await page.evaluate(() => {
    const normalizeText = (value: string | null | undefined): string =>
      (value ?? "")
        .replace(/\s+/g, " ")
        .replace(/\u00a0/g, " ")
        .trim();

    const isUniqueSelector = (selector: string): boolean => {
      try {
        return selector.length > 0 && document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };

    const safeClassSelector = (className: string): string => {
      const cleaned = className.trim();
      if (!cleaned) {
        return "";
      }
      const parts = cleaned
        .split(/\s+/)
        .filter((part) => /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(part))
        .slice(0, 2);
      return parts.map((part) => `.${CSS.escape(part)}`).join("");
    };

    const selectorFor = (element: Element | null): string => {
      if (!element) {
        return "";
      }

      if (element instanceof HTMLElement && element.id) {
        const selector = `#${CSS.escape(element.id)}`;
        if (isUniqueSelector(selector)) {
          return selector;
        }
      }

      const attrs = ["data-testid", "data-test", "name", "type", "role"];
      for (const attr of attrs) {
        const value = element.getAttribute(attr);
        if (!value) {
          continue;
        }
        const selector = `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
        if (isUniqueSelector(selector)) {
          return selector;
        }
      }

      const path: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && current !== document.documentElement) {
        const tag = current.tagName.toLowerCase();
        const classSelector = safeClassSelector(current.className);
        let selector = `${tag}${classSelector}`;
        if (!isUniqueSelector(selector)) {
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(current) + 1;
              selector = `${tag}${classSelector}:nth-of-type(${index})`;
            }
          }
        }
        path.unshift(selector);
        const joined = path.join(" > ");
        if (isUniqueSelector(joined)) {
          return joined;
        }
        current = current.parentElement;
      }
      return path.join(" > ") || element.tagName.toLowerCase();
    };

    const labelForInput = (input: HTMLInputElement | HTMLTextAreaElement): string => {
      if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) {
          return normalizeText(label.textContent);
        }
      }
      const enclosingLabel = input.closest("label");
      return normalizeText(enclosingLabel?.textContent);
    };

    const forms = Array.from(document.querySelectorAll("form")).map((form) => {
      const inputs = Array.from(form.querySelectorAll("input, textarea"))
        .slice(0, 20)
        .map((input) => ({
          selector: selectorFor(input),
          type: (input.getAttribute("type") ?? input.tagName.toLowerCase()).toLowerCase(),
          name: input.getAttribute("name") ?? undefined,
          placeholder: input.getAttribute("placeholder") ?? undefined,
          autocomplete: input.getAttribute("autocomplete") ?? undefined,
          label: labelForInput(input as HTMLInputElement | HTMLTextAreaElement) || undefined,
        }));

      return {
        selector: selectorFor(form),
        action: form.getAttribute("action") ?? undefined,
        method: (form.getAttribute("method") ?? "get").toLowerCase(),
        hasPassword: inputs.some((input) => input.type === "password"),
        inputs,
      };
    });

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((link) => ({
        selector: selectorFor(link),
        text: normalizeText(link.textContent),
        href: (link as HTMLAnchorElement).href,
      }))
      .filter((link) => link.href.length > 0)
      .slice(0, 120);

    const candidates = Array.from(document.querySelectorAll("main, article, [role='main'], body")).slice(0, 8);
    const mainContent = [...candidates].sort((left, right) => normalizeText(right.textContent).length - normalizeText(left.textContent).length)[0];
    const candidateContentSelector = selectorFor(mainContent ?? document.body);
    const candidateTitleSelector = selectorFor(document.querySelector("h1, h2, [itemprop='headline'], title"));

    const repeatedGroups = Array.from(document.querySelectorAll("body, main, section, article, div, ul, ol, table, tbody"))
      .flatMap((parent) => {
        const children = Array.from(parent.children);
        if (children.length < 3 || children.length > 50) {
          return [];
        }

        const groups = new Map<string, Element[]>();
        for (const child of children) {
          const key = `${child.tagName.toLowerCase()}|${safeClassSelector(child.className)}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)?.push(child);
        }

        return Array.from(groups.entries())
          .filter(([, group]) => group.length >= 3)
          .map(([key, group]) => {
            const [tag, classSelector] = key.split("|");
            const parentSelector = selectorFor(parent);
            const itemSelector = `${parentSelector} > ${tag}${classSelector ?? ""}`;
            const sampleTexts = group.slice(0, 3).map((item) => normalizeText(item.textContent).slice(0, 120));
            const sampleHrefs = group
              .slice(0, 3)
              .map((item) => item.querySelector("a[href]"))
              .filter((link): link is HTMLAnchorElement => Boolean(link))
              .map((link) => link.href);

            return {
              parentSelector,
              itemSelector,
              count: group.length,
              sampleTexts,
              sampleHrefs,
            };
          });
      })
      .sort((left, right) => right.count - left.count)
      .slice(0, 8);

    const textExcerpt = normalizeText(mainContent?.textContent ?? document.body.textContent).slice(0, 2000);
    return {
      url: window.location.href,
      title: document.title || normalizeText(document.querySelector("h1")?.textContent) || "Untitled",
      textExcerpt,
      textLength: normalizeText(document.body.textContent).length,
      htmlExcerpt: document.documentElement.outerHTML.slice(0, 4000),
      hasPasswordForm: forms.some((form) => form.hasPassword),
      forms,
      links,
      repeatedGroups,
      candidateContentSelector,
      candidateTitleSelector,
    };
  });

  return {
    ...profile,
    networkRequests,
  };
}
