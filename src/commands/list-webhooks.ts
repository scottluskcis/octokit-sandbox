import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import * as fs from 'fs';
import * as path from 'path';

interface WebhookData {
  type: 'Organization' | 'Repository';
  organizationName: string;
  repositoryName?: string;
  id: number;
  name: string;
  active: boolean;
  events: string[];
  url: string;
  contentType?: string;
  insecureSSL?: string;
  createdAt: string;
  updatedAt: string;
  lastResponseCode?: number | null;
  lastResponseStatus?: string;
  lastResponseMessage?: string | null;
}

const listWebhooksCommand = createBaseCommand({
  name: 'list-webhooks',
  description:
    'List repository webhooks for all repositories in a GitHub organization',
})
  .option(
    '--csv-output <csvOutput>',
    'Path to write CSV output file',
    './repo-webhooks.csv',
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting repository webhook listing...');

      const webhooks: WebhookData[] = [];

      // Get repository webhooks
      logger.info('Fetching repository webhooks...');

      // Get all repositories in the organization
      const repoIterator = octokit.paginate.iterator(
        octokit.rest.repos.listForOrg,
        {
          org: opts.orgName,
          per_page: 100,
          type: 'all',
        },
      );

      let totalRepos = 0;
      let processedRepos = 0;

      for await (const { data: repos } of repoIterator) {
        totalRepos += repos.length;

        for (const repo of repos) {
          processedRepos++;
          logger.info(
            `Processing repository ${processedRepos}/${totalRepos}: ${repo.name}`,
          );

          try {
            const repoWebhooksIterator = octokit.paginate.iterator(
              octokit.rest.repos.listWebhooks,
              {
                owner: opts.orgName,
                repo: repo.name,
                per_page: 100,
              },
            );

            for await (const { data: repoWebhooks } of repoWebhooksIterator) {
              for (const webhook of repoWebhooks) {
                webhooks.push({
                  type: 'Repository',
                  organizationName: opts.orgName,
                  repositoryName: repo.name,
                  id: webhook.id,
                  name: webhook.name,
                  active: webhook.active,
                  events: webhook.events,
                  url: webhook.config?.url || 'N/A',
                  contentType: webhook.config?.content_type,
                  insecureSSL: webhook.config?.insecure_ssl?.toString(),
                  createdAt: webhook.created_at,
                  updatedAt: webhook.updated_at,
                  lastResponseCode: webhook.last_response?.code,
                  lastResponseStatus: webhook.last_response?.status || 'N/A',
                  lastResponseMessage: webhook.last_response?.message,
                });

                logger.info(
                  `Found repo webhook: ${repo.name}/${webhook.name} (${webhook.id}) - ${webhook.config?.url}`,
                );
              }
            }
          } catch (error: any) {
            logger.warn(
              `Error fetching webhooks for repository ${repo.name}: ${error.message}`,
            );
            // Continue processing other repositories
          }
        }
      }

      // Write results to CSV
      if (webhooks.length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const csvFilename = path.join(
          process.cwd(),
          `webhooks-${opts.orgName}-${timestamp}.csv`,
        );

        // Write CSV header
        const csvHeaders = [
          'Type',
          'Organization',
          'Repository',
          'Webhook ID',
          'Name',
          'Active',
          'Events',
          'URL',
          'Content Type',
          'Insecure SSL',
          'Created At',
          'Updated At',
          'Last Response Code',
          'Last Response Status',
          'Last Response Message',
        ];

        fs.writeFileSync(csvFilename, csvHeaders.join(',') + '\n');

        // Write webhook data
        for (const webhook of webhooks) {
          const csvRow = [
            webhook.type,
            webhook.organizationName,
            webhook.repositoryName || '',
            webhook.id,
            webhook.name,
            webhook.active,
            `"${webhook.events.join(';')}"`, // Quote and join events with semicolons
            `"${webhook.url}"`, // Quote URL in case it contains commas
            webhook.contentType || '',
            webhook.insecureSSL || '',
            webhook.createdAt,
            webhook.updatedAt,
            webhook.lastResponseCode || '',
            webhook.lastResponseStatus,
            `"${webhook.lastResponseMessage || ''}"`, // Quote message in case it contains commas
          ];

          fs.appendFileSync(csvFilename, csvRow.join(',') + '\n');
        }

        logger.info(`Exported ${webhooks.length} webhooks to ${csvFilename}`);

        // Summary statistics
        const activeWebhooks = webhooks.filter((w) => w.active);

        logger.info('=== Repository Webhook Summary ===');
        logger.info(`Total repository webhooks found: ${webhooks.length}`);
        logger.info(`Active webhooks: ${activeWebhooks.length}`);
        logger.info(
          `Inactive webhooks: ${webhooks.length - activeWebhooks.length}`,
        );
        logger.info(`Total repositories processed: ${processedRepos}`);
      } else {
        logger.info('No repository webhooks found in the organization');
      }

      logger.info('Finished repository webhook listing');
    });
  });

export default listWebhooksCommand;
