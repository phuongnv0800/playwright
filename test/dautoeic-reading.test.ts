import { describe, expect, it } from "vitest";

import { buildPassageCsv, normalizePassage, parseSentenceBlocks } from "../src/scripts/dautoeic-reading.js";

describe("dautoeic reading helpers", () => {
  it("parses bilingual sentence blocks from content html", () => {
    const html = `
      <div class="sentence-block">
        <p class="sentence-en">Welcome &amp; hello.</p>
        <p class="sentence-vi">Xin chào.</p>
      </div>
      <div class="sentence-block">
        <p class="sentence-en">Second sentence.</p>
        <p class="sentence-vi">Câu thứ hai.</p>
      </div>
    `;

    expect(parseSentenceBlocks(html)).toEqual([
      {
        english: "Welcome & hello.",
        vietnamese: "Xin chào.",
      },
      {
        english: "Second sentence.",
        vietnamese: "Câu thứ hai.",
      },
    ]);
  });

  it("normalizes counts and builds csv rows", () => {
    const passage = normalizePassage({
      id: "passage-1",
      title: "A \"Quoted\" Title",
      level: "2",
      topic: "",
      content_html: `
        <div class="sentence-block">
          <p class="sentence-en">Sentence 1.</p>
          <p class="sentence-vi">Câu 1.</p>
        </div>
      `,
      vocabulary_json: [
        {
          word: "partnership",
          meaning: "quan hệ đối tác",
        },
      ],
      questions_json: [
        {
          question: "What happened?",
          correct: "A",
          choices: [
            {
              label: "A",
              text: "A partnership",
            },
          ],
        },
      ],
      order_index: 10,
      is_free: false,
      is_hidden: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    });

    expect(passage.sentenceCount).toBe(1);
    expect(passage.questionCount).toBe(1);
    expect(passage.vocabularyCount).toBe(1);
    expect(passage.accessLevel).toBe("pro");

    expect(buildPassageCsv([passage])).toContain("\"A \"\"Quoted\"\" Title\"");
  });
});
