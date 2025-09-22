import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

import { Option } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { downloadExtractAndFindFile } from '../utils/file.js';

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

    let downloadUrl: string | null = null;

    if (response.status === 302) {
      downloadUrl = response.url;
      logger.info(
        `${exportType} migration archive download URL obtained for id: ${migrationId}. Redirect URL: ${downloadUrl}`,
      );
    } else if (response.status === 200) {
      // For 200 responses, check if we have a download URL in the response headers or data
      downloadUrl =
        response.headers?.location || response.data?.url || response.url;
      if (downloadUrl) {
        logger.info(
          `${exportType} migration archive download URL obtained for id: ${migrationId}. Download URL: ${downloadUrl}`,
        );
      } else {
        logger.info(
          `${exportType} migration archive is available for id: ${migrationId}, but no direct download URL found. Response: ${JSON.stringify(response.headers)}`,
        );
        return true;
      }
    } else {
      logger.error(
        `Failed to get download URL for ${exportType.toLowerCase()} migration archive ID ${migrationId}. Status: ${response.status}`,
      );
      return false;
    }

    // If we have a download URL, download and extract the archive to look for errors
    if (downloadUrl) {
      const tempDir = path.join(process.cwd(), 'temp');
      const archiveName = `migration-${migrationId}.tar.gz`;
      const extractDirName = `migration-${migrationId}-extracted`;

      try {
        const { content: errorContent, cleanup } =
          await downloadExtractAndFindFile(
            downloadUrl,
            tempDir,
            archiveName,
            extractDirName,
            'error.json',
            logger,
          );

        if (errorContent) {
          try {
            const errorData = JSON.parse(errorContent);

            // Handle different error structures
            if (errorData.error) {
              // Single error message
              logger.error(
                `Migration error found in ${exportType.toLowerCase()} export ${migrationId}: ${errorData.error}`,
              );
            } else if (errorData.errors && Array.isArray(errorData.errors)) {
              // Multiple errors in an array
              logger.error(
                `Migration errors found in ${exportType.toLowerCase()} export ${migrationId}:`,
              );
              errorData.errors.forEach((error: any, index: number) => {
                const errorMsg =
                  typeof error === 'string'
                    ? error
                    : error.error || error.message || JSON.stringify(error);
                logger.error(`  ${index + 1}. ${errorMsg}`);
              });
            } else if (Array.isArray(errorData)) {
              // Error data is directly an array
              logger.error(
                `Migration errors found in ${exportType.toLowerCase()} export ${migrationId}:`,
              );
              errorData.forEach((error: any, index: number) => {
                const errorMsg =
                  typeof error === 'string'
                    ? error
                    : error.error || error.message || JSON.stringify(error);
                logger.error(`  ${index + 1}. ${errorMsg}`);
              });
            } else {
              // Fallback to stringify the entire object
              logger.error(
                `Migration error found in ${exportType.toLowerCase()} export ${migrationId}: ${JSON.stringify(errorData)}`,
              );
            }
          } catch (parseError) {
            logger.error(
              `Migration error found in ${exportType.toLowerCase()} export ${migrationId}, but could not parse JSON: ${errorContent}`,
            );
          }
        } else {
          logger.info(
            `No error.json found in ${exportType.toLowerCase()} migration archive.`,
          );
        }

        // Cleanup temporary files
        await cleanup();
      } catch (downloadError) {
        logger.error(`Failed to download or extract archive: ${downloadError}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.error(
      `Error downloading ${exportType.toLowerCase()} migration archive for migration ID ${migrationId}:`,
      error,
    );
    return false;
  }
}

interface ExportIdPair {
  metadataExportId: number;
  gitExportId: number;
}

interface ExportIdsFile {
  exportIds: ExportIdPair[];
}

async function readExportIdsFromFile(
  filePath: string,
): Promise<ExportIdPair[]> {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const data: ExportIdsFile = JSON.parse(fileContent);

    if (!data.exportIds || !Array.isArray(data.exportIds)) {
      throw new Error('JSON file must contain an "exportIds" array');
    }

    return data.exportIds;
  } catch (error) {
    throw new Error(`Failed to read or parse JSON file: ${error}`);
  }
}

async function processExportIdPair(
  octokit: any,
  logger: any,
  orgName: string,
  exportIdPair: ExportIdPair,
  index?: number,
): Promise<void> {
  const prefix = index !== undefined ? `[${index + 1}] ` : '';

  logger.info(
    `${prefix}Processing export pair - Git ID: ${exportIdPair.gitExportId}, Metadata ID: ${exportIdPair.metadataExportId}`,
  );

  const gitExportResult = await getMigrationStatus(
    octokit,
    logger,
    orgName,
    exportIdPair.gitExportId,
    'Git',
  );

  if (!gitExportResult.success) {
    logger.error(
      `${prefix}Git export status check failed, continuing with metadata export...`,
    );
  } else if (gitExportResult.state === 'failed') {
    logger.warn(
      `${prefix}Git export failed, attempting to download archive...`,
    );
    await downloadMigrationArchive(
      octokit,
      logger,
      orgName,
      exportIdPair.gitExportId,
      'Git',
    );
  }

  const metadataExportResult = await getMigrationStatus(
    octokit,
    logger,
    orgName,
    exportIdPair.metadataExportId,
    'Metadata',
  );

  if (!metadataExportResult.success) {
    logger.error(`${prefix}Metadata export status check failed.`);
  } else if (metadataExportResult.state === 'failed') {
    logger.warn(
      `${prefix}Metadata export failed, attempting to download archive...`,
    );
    await downloadMigrationArchive(
      octokit,
      logger,
      orgName,
      exportIdPair.metadataExportId,
      'Metadata',
    );
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
  .addOption(
    new Option(
      '--json-file <jsonFile>',
      'Path to JSON file containing multiple export ID pairs',
    ).env('JSON_FILE'),
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting...');

      try {
        // Check if JSON file is provided
        if (options.jsonFile) {
          logger.info(`Reading export IDs from JSON file: ${options.jsonFile}`);
          const exportIdPairs = await readExportIdsFromFile(options.jsonFile);

          logger.info(
            `Found ${exportIdPairs.length} export ID pair(s) to process`,
          );

          for (let i = 0; i < exportIdPairs.length; i++) {
            await processExportIdPair(
              octokit,
              logger,
              opts.orgName,
              exportIdPairs[i],
              i,
            );
          }
        } else {
          // Check if individual IDs are provided
          if (!options.metadataExportId || !options.gitExportId) {
            logger.error(
              'Either --json-file must be provided, or both --metadata-export-id and --git-export-id must be provided',
            );
            return;
          }

          const exportIdPair: ExportIdPair = {
            metadataExportId: parseInt(options.metadataExportId, 10),
            gitExportId: parseInt(options.gitExportId, 10),
          };

          await processExportIdPair(
            octokit,
            logger,
            opts.orgName,
            exportIdPair,
          );
        }
      } catch (error) {
        logger.error('Error processing export status:', error);
        throw error;
      }

      logger.info('Finished');
    });
  });

export default getMigrationExportStatusCommand;
