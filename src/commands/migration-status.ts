import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

const getMigrationStatusCommand = createBaseCommand({
  name: 'sample-command',
  description: 'Description of the sample command',
}).action(async (options) => {
  await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
    logger.info('Starting...');

    // do your work here using octokit
    // ....

    logger.info('Finished');
  });
});

export default getMigrationStatusCommand;
