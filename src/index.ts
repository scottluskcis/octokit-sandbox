import {
  executeWithOctokit,
  getOptsFromEnv,
} from '@scottluskcis/octokit-harness';

import { filesize } from 'filesize';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

const opts = getOptsFromEnv();
const RELEASE_ASSETS_WARNING_THRESHOLD_IN_BYTES = 5 * 1000 * 1000 * 1000; // 5 GB

// Get repo names from CSV file specified in environment variable
const repoListFile = process.env.REPO_LIST || './repos.csv';
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
  console.error(`Error reading repository list from ${repoListFile}:`, error);
  process.exit(1);
}

executeWithOctokit(opts, async ({ octokit, logger }) => {
  logger.info('Starting...');
  logger.info(`Found ${repoNames.length} repositories to process`);

  // Create an array to track repository sizes
  interface RepoSizeInfo {
    name: string;
    sizeInBytes: number;
    exceedsThreshold: boolean;
  }

  const repoSizes: RepoSizeInfo[] = [];

  for (const repoName of repoNames) {
    logger.info(`Processing repository: ${repoName}`);

    const releasesIterator = octokit.paginate.iterator(
      'GET /repos/{owner}/{repo}/releases',
      {
        owner: opts.orgName,
        repo: repoName,
        per_page: 100,
      },
    );

    let releaseAssetsTotalSizeInBytes = 0;

    for await (const { data: releases } of releasesIterator) {
      const releaseAssets = releases.flatMap((release) => release.assets);

      const releaseAssetsPageTotalInBytes = releaseAssets.reduce(
        (total, asset) => total + asset.size,
        0,
      );

      releaseAssetsTotalSizeInBytes += releaseAssetsPageTotalInBytes;

      logger.debug(
        `Repo: ${repoName} Release assets found ${filesize(releaseAssetsPageTotalInBytes)}.`,
      );
    }

    // Add repo info to the tracking array
    repoSizes.push({
      name: repoName,
      sizeInBytes: releaseAssetsTotalSizeInBytes,
      exceedsThreshold:
        releaseAssetsTotalSizeInBytes >=
        RELEASE_ASSETS_WARNING_THRESHOLD_IN_BYTES,
    });

    if (
      releaseAssetsTotalSizeInBytes >= RELEASE_ASSETS_WARNING_THRESHOLD_IN_BYTES
    ) {
      logger.warn(
        `Repo: ${repoName} Total size of release assets is ${filesize(releaseAssetsTotalSizeInBytes)}, which is above the warning threshold of ${filesize(RELEASE_ASSETS_WARNING_THRESHOLD_IN_BYTES)}.`,
      );
    } else {
      logger.info(
        `Repo: ${repoName} Total size of release assets is ${filesize(releaseAssetsTotalSizeInBytes)}.`,
      );
    }
  }

  // Sort repositories by size in descending order
  repoSizes.sort((a, b) => b.sizeInBytes - a.sizeInBytes);

  // Output summary table
  logger.info('=== Repository Size Summary ===');
  logger.info('Repository Name | Size | Exceeds Threshold');
  logger.info('----------------|------|------------------');

  for (const repo of repoSizes) {
    logger.info(
      `${repo.name.padEnd(16)} | ${filesize(repo.sizeInBytes).padEnd(6)} | ${repo.exceedsThreshold ? 'YES' : 'NO'}`,
    );
  }

  // Calculate and output total size
  const totalSizeInBytes = repoSizes.reduce(
    (total, repo) => total + repo.sizeInBytes,
    0,
  );
  logger.info(
    `Total size across all repositories: ${filesize(totalSizeInBytes)}`,
  );

  // Count repositories exceeding threshold
  const reposExceedingThreshold = repoSizes.filter(
    (repo) => repo.exceedsThreshold,
  ).length;
  if (reposExceedingThreshold > 0) {
    logger.warn(
      `${reposExceedingThreshold} repositories exceed the size threshold`,
    );
  }

  logger.info('Done!');
});
