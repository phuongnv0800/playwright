import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_SUPABASE_URL = "https://qfhmnlvgweznzcsoijyr.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmaG1ubHZnd2V6bnpjc29panlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MDYyMzQsImV4cCI6MjA4NDM4MjIzNH0.mNJAoc-uJVilLr03PT3luXsekfwJ4sICOIsOIRQu-N0";

const SELECT_FIELDS = [
  "id",
  "title",
  "level",
  "topic",
  "content_html",
  "vocabulary_json",
  "questions_json",
  "order_index",
  "is_free",
  "is_hidden",
  "created_at",
  "updated_at",
].join(",");

export interface DautoeicRawVocabulary {
  word: string;
  meaning: string;
}

export interface DautoeicRawQuestionChoice {
  label: string;
  text: string;
}

export interface DautoeicRawQuestion {
  choices: DautoeicRawQuestionChoice[];
  correct: string;
  question: string;
  explanation?: string;
  translation?: string;
}

export interface DautoeicRawPassage {
  id: string;
  title: string;
  level: string;
  topic: string;
  content_html: string;
  vocabulary_json: unknown;
  questions_json: unknown;
  order_index: number | null;
  is_free: boolean;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface SentenceBlock {
  english: string;
  vietnamese: string;
}

export interface DautoeicReadingPassage {
  id: string;
  url: string;
  title: string;
  level: number;
  topic: string | null;
  orderIndex: number | null;
  accessLevel: "free" | "pro";
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
  sentenceCount: number;
  questionCount: number;
  vocabularyCount: number;
  sentences: SentenceBlock[];
  vocabulary: DautoeicRawVocabulary[];
  questions: DautoeicRawQuestion[];
  contentHtml: string;
}

export interface DautoeicCrawlSummary {
  crawledAt: string;
  sourceUrl: string;
  totalPassages: number;
  freePassages: number;
  proPassages: number;
  totalQuestions: number;
  totalVocabularyEntries: number;
  totalSentenceBlocks: number;
  levels: Record<string, number>;
}

export interface DautoeicCrawlResult {
  passages: DautoeicReadingPassage[];
  summary: DautoeicCrawlSummary;
}

export interface DautoeicCrawlOptions {
  includeHidden?: boolean;
  pageSize?: number;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export interface DautoeicWriteResult {
  outputDir: string;
  passagesPath: string;
  summaryPath: string;
  csvPath: string;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBlockText(blockHtml: string, className: string): string {
  const matcher = new RegExp(
    `<[^>]*class="[^"]*\\b${escapeRegex(className)}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i",
  );
  const match = blockHtml.match(matcher);
  return match ? stripHtml(match[1]) : "";
}

export function parseSentenceBlocks(contentHtml: string): SentenceBlock[] {
  const blocks = Array.from(
    contentHtml.matchAll(/<div[^>]*class="[^"]*\bsentence-block\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi),
  );

  return blocks
    .map((match) => {
      const blockHtml = match[1] ?? "";
      return {
        english: extractBlockText(blockHtml, "sentence-en"),
        vietnamese: extractBlockText(blockHtml, "sentence-vi"),
      };
    })
    .filter((block) => block.english.length > 0 || block.vietnamese.length > 0);
}

function normalizeVocabulary(value: unknown): DautoeicRawVocabulary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.word === "string" &&
      typeof entry.meaning === "string"
    ) {
      return [
        {
          word: entry.word.trim(),
          meaning: entry.meaning.trim(),
        },
      ];
    }

    return [];
  });
}

function normalizeChoices(value: unknown): DautoeicRawQuestionChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.label === "string" &&
      typeof entry.text === "string"
    ) {
      return [
        {
          label: entry.label.trim(),
          text: entry.text.trim(),
        },
      ];
    }

    return [];
  });
}

function normalizeQuestions(value: unknown): DautoeicRawQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.question !== "string" ||
      typeof entry.correct !== "string"
    ) {
      return [];
    }

    return [
      {
        question: entry.question.trim(),
        correct: entry.correct.trim(),
        choices: normalizeChoices(entry.choices),
        explanation: typeof entry.explanation === "string" ? entry.explanation.trim() : undefined,
        translation: typeof entry.translation === "string" ? entry.translation.trim() : undefined,
      },
    ];
  });
}

export function normalizePassage(raw: DautoeicRawPassage): DautoeicReadingPassage {
  const sentences = parseSentenceBlocks(raw.content_html);
  const vocabulary = normalizeVocabulary(raw.vocabulary_json);
  const questions = normalizeQuestions(raw.questions_json);

  return {
    id: raw.id,
    url: `https://dautoeic.com/reading/${raw.id}`,
    title: raw.title.trim(),
    level: Number.parseInt(raw.level, 10),
    topic: raw.topic.trim().length > 0 ? raw.topic.trim() : null,
    orderIndex: raw.order_index,
    accessLevel: raw.is_free ? "free" : "pro",
    isHidden: raw.is_hidden,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    sentenceCount: sentences.length,
    questionCount: questions.length,
    vocabularyCount: vocabulary.length,
    sentences,
    vocabulary,
    questions,
    contentHtml: raw.content_html,
  };
}

async function fetchPassagePage(
  offset: number,
  limit: number,
  options: Required<Pick<DautoeicCrawlOptions, "includeHidden" | "supabaseUrl" | "supabaseAnonKey">>,
): Promise<DautoeicRawPassage[]> {
  const url = new URL("/rest/v1/reading_passages", options.supabaseUrl);
  url.searchParams.set("select", SELECT_FIELDS);
  url.searchParams.set("order", "order_index.asc,id.asc");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (!options.includeHidden) {
    url.searchParams.set("is_hidden", "eq.false");
  }

  const response = await fetch(url, {
    headers: {
      apikey: options.supabaseAnonKey,
      Authorization: `Bearer ${options.supabaseAnonKey}`,
      "Accept-Profile": "public",
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed with ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Supabase response is not an array");
  }

  return data as DautoeicRawPassage[];
}

export async function crawlDautoeicReading(
  options: DautoeicCrawlOptions = {},
): Promise<DautoeicCrawlResult> {
  const includeHidden = options.includeHidden ?? false;
  const pageSize = options.pageSize ?? 50;
  const supabaseUrl = options.supabaseUrl ?? process.env.DAUTOEIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
  const supabaseAnonKey =
    options.supabaseAnonKey ?? process.env.DAUTOEIC_SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;

  const rawPassages: DautoeicRawPassage[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPassagePage(offset, pageSize, {
      includeHidden,
      supabaseUrl,
      supabaseAnonKey,
    });
    rawPassages.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }

  const passages = rawPassages.map(normalizePassage);
  const levels = passages.reduce<Record<string, number>>((accumulator, passage) => {
    const key = String(passage.level);
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    passages,
    summary: {
      crawledAt: new Date().toISOString(),
      sourceUrl: "https://dautoeic.com/reading",
      totalPassages: passages.length,
      freePassages: passages.filter((passage) => passage.accessLevel === "free").length,
      proPassages: passages.filter((passage) => passage.accessLevel === "pro").length,
      totalQuestions: passages.reduce((sum, passage) => sum + passage.questionCount, 0),
      totalVocabularyEntries: passages.reduce((sum, passage) => sum + passage.vocabularyCount, 0),
      totalSentenceBlocks: passages.reduce((sum, passage) => sum + passage.sentenceCount, 0),
      levels,
    },
  };
}

function escapeCsvValue(value: string | number | boolean | null): string {
  const rendered = value === null ? "" : String(value);
  if (/[",\n]/.test(rendered)) {
    return `"${rendered.replace(/"/g, "\"\"")}"`;
  }
  return rendered;
}

export function buildPassageCsv(passages: DautoeicReadingPassage[]): string {
  const header = [
    "id",
    "title",
    "level",
    "access_level",
    "order_index",
    "question_count",
    "vocabulary_count",
    "sentence_count",
    "topic",
    "url",
  ];

  const rows = passages.map((passage) =>
    [
      passage.id,
      passage.title,
      passage.level,
      passage.accessLevel,
      passage.orderIndex,
      passage.questionCount,
      passage.vocabularyCount,
      passage.sentenceCount,
      passage.topic,
      passage.url,
    ]
      .map((value) => escapeCsvValue(value))
      .join(","),
  );

  return [header.join(","), ...rows].join("\n");
}

export async function writeDautoeicReadingArtifacts(
  result: DautoeicCrawlResult,
  outputDir: string,
): Promise<DautoeicWriteResult> {
  const resolvedOutputDir = resolve(outputDir);
  await mkdir(resolvedOutputDir, { recursive: true });

  const passagesPath = resolve(resolvedOutputDir, "passages.json");
  const summaryPath = resolve(resolvedOutputDir, "summary.json");
  const csvPath = resolve(resolvedOutputDir, "passages.csv");

  await Promise.all([
    writeFile(passagesPath, `${JSON.stringify(result.passages, null, 2)}\n`, "utf8"),
    writeFile(summaryPath, `${JSON.stringify(result.summary, null, 2)}\n`, "utf8"),
    writeFile(csvPath, `${buildPassageCsv(result.passages)}\n`, "utf8"),
  ]);

  return {
    outputDir: resolvedOutputDir,
    passagesPath,
    summaryPath,
    csvPath,
  };
}
