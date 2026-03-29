import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1).default("postgres://postgres:postgres@localhost:5432/automation_platform"),
  LOG_LEVEL: z.string().default("info"),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  PLAYWRIGHT_STATE_DIR: z.string().default("./playwright-state"),
  CRAWL_EXPORT_DIR: z.string().default("./output/crawl-runs"),
  PLAYWRIGHT_DEFAULT_TIMEOUT_MS: z.coerce.number().default(15_000),
  JOB_POLL_INTERVAL_SECONDS: z.coerce.number().default(5),
  AI_PROVIDER: z.string().default("stub"),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  CODEX_AUTH_BASE_URL: z.string().optional(),
  CODEX_AUTH_TOKEN: z.string().optional(),
  CODEX_AUTH_MODEL: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
