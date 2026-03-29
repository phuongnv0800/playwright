import { fileURLToPath } from "node:url";

import { crawlDautoeicReading, writeDautoeicReadingArtifacts } from "./dautoeic-reading.js";

interface CliOptions {
  outputDir: string;
  includeHidden: boolean;
  pageSize: number;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    outputDir: "output/dautoeic-reading",
    includeHidden: false,
    pageSize: 50,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) {
      continue;
    }

    if (argument === "--include-hidden") {
      options.includeHidden = true;
      continue;
    }

    if (argument === "--output-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --output-dir");
      }
      options.outputDir = value;
      index += 1;
      continue;
    }

    if (argument === "--page-size") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --page-size");
      }
      const pageSize = Number.parseInt(value, 10);
      if (!Number.isFinite(pageSize) || pageSize <= 0) {
        throw new Error(`Invalid --page-size value: ${value}`);
      }
      options.pageSize = pageSize;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return options;
}

export async function main(argv: string[]): Promise<void> {
  const options = parseCliArgs(argv);
  const result = await crawlDautoeicReading({
    includeHidden: options.includeHidden,
    pageSize: options.pageSize,
  });
  const written = await writeDautoeicReadingArtifacts(result, options.outputDir);

  console.log(
    JSON.stringify(
      {
        ...result.summary,
        outputDir: written.outputDir,
        files: {
          passages: written.passagesPath,
          summary: written.summaryPath,
          csv: written.csvPath,
        },
      },
      null,
      2,
    ),
  );
}

const isDirectRun = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
