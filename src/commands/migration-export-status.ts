import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

import { Option } from 'commander';

async function getMigrationStatus(
  octokit: any,
  logger: any,
  orgName: string,
  migrationId: number,
  exportType: string,
): Promise<{ success: boolean; state?: string }> {
  try {
    const response = await octokit.rest.migrations.getStatusForOrg({
      org: orgName,
      migration_id: migrationId,
    });

    if (response.status === 200) {
      const exportData = response.data;
      logger.info(
        `${exportType} Export for id: ${migrationId} - State: ${exportData.state}`,
      );
      return { success: true, state: exportData.state };
    } else {
      logger.error(
        `Failed to get ${exportType.toLowerCase()} export status for migration ID ${migrationId}. Status: ${response.status}`,
      );
      return { success: false };
    }
  } catch (error) {
    logger.error(
      `Error getting ${exportType.toLowerCase()} export status for migration ID ${migrationId}:`,
      error,
    );
    return { success: false };
  }
}

async function downloadMigrationArchive(
  octokit: any,
  logger: any,
  orgName: string,
  migrationId: number,
  exportType: string,
): Promise<boolean> {
  try {
    logger.info(
      `Attempting to download ${exportType.toLowerCase()} migration archive for id: ${migrationId}...`,
    );

    const response = await octokit.rest.migrations.downloadArchiveForOrg({
      org: orgName,
      migration_id: migrationId,
    });

    if (response.status === 302) {
      logger.info(
        `${exportType} migration archive download URL obtained for id: ${migrationId}. Redirect URL: ${response.url}`,
      );
      return true;
    } else {
      logger.error(
        `Failed to get download URL for ${exportType.toLowerCase()} migration archive ID ${migrationId}. Status: ${response.status}`,
      );
      return false;
    }
  } catch (error) {
    logger.error(
      `Error downloading ${exportType.toLowerCase()} migration archive for migration ID ${migrationId}:`,
      error,
    );
    return false;
  }
}

const getMigrationExportStatusCommand = createBaseCommand({
  name: 'migration-export-status',
  description: 'Checks migration export status',
})
  .addOption(
    new Option(
      '--metadata-export-id <metadataExportId>',
      'The metadata id associated with the export',
    ).env('METADATA_EXPORT_ID'),
  )
  .addOption(
    new Option(
      '--git-export-id <gitExportId>',
      'The git id associated with the export',
    ).env('GIT_EXPORT_ID'),
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting...');

      const gitExportResult = await getMigrationStatus(
        octokit,
        logger,
        opts.orgName,
        options.gitExportId,
        'Git',
      );

      if (!gitExportResult.success) {
        logger.error(
          'Git export status check failed, continuing with metadata export...',
        );
      } else if (gitExportResult.state === 'failed') {
        logger.warn('Git export failed, attempting to download archive...');
        await downloadMigrationArchive(
          octokit,
          logger,
          opts.orgName,
          options.gitExportId,
          'Git',
        );
      }

      const metadataExportResult = await getMigrationStatus(
        octokit,
        logger,
        opts.orgName,
        options.metadataExportId,
        'Metadata',
      );

      if (!metadataExportResult.success) {
        logger.error('Metadata export status check failed.');
      } else if (metadataExportResult.state === 'failed') {
        logger.warn(
          'Metadata export failed, attempting to download archive...',
        );
        await downloadMigrationArchive(
          octokit,
          logger,
          opts.orgName,
          options.metadataExportId,
          'Metadata',
        );
      }

      logger.info('Finished');
    });
  });

export default getMigrationExportStatusCommand;
