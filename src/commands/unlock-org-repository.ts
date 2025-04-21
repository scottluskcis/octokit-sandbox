import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

import { Option } from 'commander';

const unlockOrgRepositoryCommand = createBaseCommand({
  name: 'unlock-org-repository',
  description: 'Unlock an organization repository',
})
  .addOption(
    new Option('--migration-id <migrationId>', 'The ID of the migration').env(
      'MIGRATION_ID',
    ),
  )
  .addOption(
    new Option(
      '--repo-name <repoName>',
      'The name of the repository to unlock',
    ).env('REPO_NAME'),
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting...');

      const response = await octokit.request(
        'DELETE /orgs/{org}/migrations/{migration_id}/repos/{repo_name}/lock',
        {
          org: opts.orgName,
          migration_id: options.migrationId,
          repo_name: options.repoName,
        },
      );

      if (response.status === 204) {
        logger.info(
          `Successfully unlocked repository ${options.repoName} in migration ${options.migrationId}`,
        );
      } else {
        logger.error(
          `Failed to unlock repository ${options.repoName} in migration ${options.migrationId}`,
        );
      }

      logger.info('Finished');
    });
  });

export default unlockOrgRepositoryCommand;
