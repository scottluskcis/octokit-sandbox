import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import * as fs from 'fs';
import * as path from 'path';

const listOrgMigrationsCommand = createBaseCommand({
  name: 'list-org-migrations',
  description: 'List organization migrations',
}).action(async (options) => {
  await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
    logger.info('Starting...');

    // Create a CSV filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const csvFilename = path.join(
      process.cwd(),
      `org-migrations-${opts.orgName}-${timestamp}.csv`,
    );

    // Write CSV header
    fs.writeFileSync(
      csvFilename,
      'Migration ID,State,Created At,Updated At,Repositories\n',
    );

    const migrationsIterator = octokit.paginate.iterator(
      octokit.rest.migrations.listForOrg,
      {
        org: opts.orgName,
        per_page: 100,
      },
    );

    let count = 0;
    for await (const { data: migrations } of migrationsIterator) {
      for (const migration of migrations) {
        // Extract repository names from the repositories array
        const repoNames = migration.repositories
          ? migration.repositories.map((repo) => repo.name).join(';')
          : '';

        // Append each migration as a CSV row
        fs.appendFileSync(
          csvFilename,
          `${migration.id},${migration.state},${migration.created_at},${migration.updated_at},"${repoNames}"\n`,
        );
        count++;
      }
    }

    logger.info(`Exported ${count} migrations to ${csvFilename}`);
    logger.info('Finished');
  });
});

export default listOrgMigrationsCommand;
