import {
  executeWithOctokit,
  getOptsFromEnv,
} from '@scottluskcis/octokit-harness';

import { filesize } from 'filesize';

const opts = getOptsFromEnv();
const RELEASE_ASSETS_WARNING_THRESHOLD_IN_BYTES = 5 * 1000 * 1000 * 1000; // 5 GB

executeWithOctokit(opts, async ({ octokit, logger }) => {
  logger.info('Starting...');

  const repoName = 'developer-portal';

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

    console.debug(
      `Repo: ${repoName} Release assets found ${filesize(releaseAssetsPageTotalInBytes)}.`,
    );
  }

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

  logger.info('Done!');
});
