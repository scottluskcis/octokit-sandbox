import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

/**
 * Reads repository names from a CSV file
 * @param repoListFile Path to the CSV file containing repository names
 * @param logger Logger instance to use for error reporting
 * @returns Array of repository names
 */
export function readRepositoryNames(
  repoListFile: string,
  logger: any,
): string[] {
  let repoNames: string[] = [];

  try {
    const fileContent = readFileSync(repoListFile, 'utf-8');
    const records = parse(fileContent, {
      trim: true,
      skip_empty_lines: true,
      columns: false,
    });

    // Extract repo names from CSV (first column only)
    repoNames = records.map((record: any[]) => record[0]);

    if (repoNames.length === 0) {
      throw new Error('No repository names found in CSV file');
    }
  } catch (error) {
    logger.error(`Error reading repository list from ${repoListFile}:`, error);
  }

  if (repoNames.length === 0) {
    logger.error('No repositories to process, exiting');
    return [];
  }

  logger.info(`Found ${repoNames.length} repositories to process`);

  return repoNames;
}
