import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

const listWebhooksCommand = createBaseCommand({
  name: 'list-webhooks',
  description: 'List webhooks for a GitHub organization',
}).action(async (options) => {
  await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
    logger.info('Starting...');

    // do your work here using octokit
    // ....

    logger.info('Finished');
  });
});

export default listWebhooksCommand;
