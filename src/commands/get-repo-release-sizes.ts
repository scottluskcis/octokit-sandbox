import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import { filesize } from 'filesize';
import { readRepositoryNames } from '../utils.js';

const getRepoReleaseSizesCommand = createBaseCommand({
  name: 'get-repo-release-sizes',
  description: 'Get the size of releases for specified repositories',
})
  .option(
    '--threshold <bytes>',
    'Warning threshold for release assets size in bytes',
    '5000000000',
  ) // 5GB default
  .option(
    '--repo-list <path>',
    'Path to CSV file containing repository names',
    './repositories.csv',
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting get releases sizes...');

      const RELEASE_ASSETS_WARNING_THRESHOLD_IN_BYTES = parseInt(
        options.threshold,
        10,
      );

      // Read repository names using the utility function
      const repoNames = readRepositoryNames(options.repoList, logger);

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
          releaseAssetsTotalSizeInBytes >=
          RELEASE_ASSETS_WARNING_THRESHOLD_IN_BYTES
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

      logger.info('Finished get releases sizes');
    });
  });

export default getRepoReleaseSizesCommand;
