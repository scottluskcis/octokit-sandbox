import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

const sampleCommand = createBaseCommand({
  name: 'find-packages',
  description: 'Find packages in a repository',
}).action(async (options) => {
  await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
    logger.info('Starting...');

    // do your work here using octokit
    // ....

    logger.info('Finished');
  });
});

export default sampleCommand;
