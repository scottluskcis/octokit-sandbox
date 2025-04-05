import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

const findPackagesCommand = createBaseCommand({
  name: 'find-packages',
  description: 'Find packages in a repository',
}).action(async (options) => {
  await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
    logger.info('Starting find packages...');

    if (octokit) logger.info('Octokit is defined');
    if (opts) logger.info('Opts is defined');

    logger.info('Finished find packages');
  });
});

export default findPackagesCommand;
