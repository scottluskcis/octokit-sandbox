import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

import { Octokit, PageInfoForward } from 'octokit';

import fs from 'fs';
import path from 'path';
import { filesize } from 'filesize';

interface PackageFile {
  name: string;
  size: number;
  updatedAt: string;
}

interface PackageVersion {
  files: {
    nodes: PackageFile[];
  };
  version: string;
}

interface PackageDetail {
  name: string;
  packageType: string;
  repository: {
    name: string;
    isArchived: boolean;
    visibility: string;
  } | null;
  statistics: {
    downloadsTotalCount: number;
  };
  latestVersion: PackageVersion | null;
  versions: {
    totalCount: number;
  };
}

interface PackagesResponse {
  organization: {
    packages: {
      nodes: PackageDetail[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
}

interface PackageVersionFile {
  size: number;
}

interface PackageVersionNode {
  id: string;
  files: {
    nodes: PackageVersionFile[];
    totalCount: number;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
}

interface PackageVersionsResponse {
  organization: {
    packages: {
      nodes: [
        {
          versions: {
            nodes: PackageVersionNode[];
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
          };
        },
      ];
    };
  };
}

// Interface for file response from PACKAGE_VERSION_FILES_QUERY
interface PackageVersionFilesResponse {
  node: {
    files: {
      nodes: PackageVersionFile[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
}

const PACKAGE_DETAILS_QUERY = `
query($organization: String!, $packageType: PackageType!, $pageSize: Int!, $endCursor: String) {
  organization(login: $organization) {
    packages(first: $pageSize, packageType: $packageType, after: $endCursor) {
      nodes {
        name
        packageType
        repository {
          name
          isArchived
          visibility
        }
        statistics {
          downloadsTotalCount 
        }
        latestVersion { 
          files(last: 100, orderBy: {field: CREATED_AT, direction: ASC}) {
            nodes {
              name
              size
              updatedAt
            }
          }
          version
        } 
        versions {
            totalCount
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

const PACKAGE_VERSIONS_QUERY = `
query($organization: String!, $packageName: String!, $pageSize: Int!, $endCursor: String) {
  organization(login: $organization) {
    packages(first: 1, names: [$packageName]) {
      nodes {
        versions(first: $pageSize, after: $endCursor) {
          nodes {
            id
            files(first: 100) {
              nodes {
                size
              }
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
}`;

const PACKAGE_VERSION_FILES_QUERY = `
query($versionId: ID!, $pageSize: Int!, $endCursor: String) {
  node(id: $versionId) {
    ... on PackageVersion {
      files(first: $pageSize, after: $endCursor) {
        nodes {
          size
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}`;

async function* getOrgPackageDetails(
  octokit: Octokit,
  organization: string,
  packageType: string,
  logger: any,
  pageSize: number = 100,
  endCursor: string | null = null,
): AsyncGenerator<PackageDetail, void, unknown> {
  let totalFetched = 0;
  let pageCount = 0;
  let hasNextPage = true;
  let currentCursor = endCursor;

  while (hasNextPage) {
    pageCount++;
    logger.info(
      `Fetching page ${pageCount} with cursor: ${currentCursor || 'initial'}`,
    );

    const response = await octokit.graphql<PackagesResponse>(
      PACKAGE_DETAILS_QUERY,
      {
        organization,
        packageType,
        pageSize,
        endCursor: currentCursor,
      },
    );

    const packages = response.organization.packages.nodes;
    const pageInfo = response.organization.packages.pageInfo;

    totalFetched += packages.length;
    logger.info(
      `Page ${pageCount}: Retrieved ${packages.length} packages (${totalFetched} total so far)`,
    );
    logger.info(
      `Has next page: ${pageInfo.hasNextPage}, End cursor: ${pageInfo.endCursor}`,
    );

    for (const pkg of packages) {
      yield pkg;
    }

    hasNextPage = pageInfo.hasNextPage;
    currentCursor = pageInfo.endCursor;

    if (!hasNextPage) {
      logger.info(
        `Reached final page. Total packages fetched: ${totalFetched}`,
      );
    }
  }
}

async function getPackageVersionDetails(
  octokit: Octokit,
  organization: string,
  packageName: string,
  logger: any,
  pageSize: number = 100,
): Promise<{ totalFiles: number; totalSize: number; totalVersions: number }> {
  let totalFiles = 0;
  let totalSize = 0;
  let totalVersions = 0;
  let hasNextPage = true;
  let currentCursor: string | null = null;
  let pageCount = 0;

  while (hasNextPage) {
    pageCount++;
    logger.debug(
      `Fetching version page ${pageCount} for package ${packageName} with cursor: ${currentCursor || 'initial'}`,
    );

    const response: PackageVersionsResponse =
      await octokit.graphql<PackageVersionsResponse>(PACKAGE_VERSIONS_QUERY, {
        organization,
        packageName,
        pageSize,
        endCursor: currentCursor,
      });

    const packageNode = response.organization.packages.nodes[0];
    if (!packageNode) {
      break;
    }

    const versions = packageNode.versions.nodes;
    totalVersions += versions.length;
    const pageInfo = packageNode.versions.pageInfo;

    // Process each version
    for (const version of versions) {
      const versionId = version.id;
      totalFiles += version.files.totalCount;

      // Add sizes from first page of files
      for (const file of version.files.nodes) {
        totalSize += file.size;
      }

      // Check if we need to fetch additional file pages
      if (version.files.totalCount > version.files.nodes.length) {
        logger.debug(
          `Package ${packageName} has ${version.files.totalCount} files, fetching all pages`,
        );

        let fileHasNextPage = version.files.pageInfo.hasNextPage;
        let fileCurrentCursor = version.files.pageInfo.endCursor;
        let filePageCount = 1;

        // Continue fetching file pages until we've got them all
        while (fileHasNextPage) {
          filePageCount++;
          logger.debug(
            `Fetching file page ${filePageCount} for version ${versionId} with cursor: ${fileCurrentCursor}`,
          );

          const fileResponse =
            await octokit.graphql<PackageVersionFilesResponse>(
              PACKAGE_VERSION_FILES_QUERY,
              {
                versionId,
                pageSize: 100,
                endCursor: fileCurrentCursor,
              },
            );

          // Add sizes from additional file pages
          const fileNodes = fileResponse.node.files.nodes;
          for (const file of fileNodes) {
            totalSize += file.size;
          }

          fileHasNextPage = fileResponse.node.files.pageInfo.hasNextPage;
          fileCurrentCursor = fileResponse.node.files.pageInfo.endCursor;

          logger.debug(
            `Retrieved ${fileNodes.length} more files for version ${versionId}`,
          );
        }
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    currentCursor = pageInfo.endCursor;

    if (!hasNextPage) {
      logger.debug(
        `Reached final version page for package ${packageName}. Total versions: ${totalVersions}, Total files: ${totalFiles}, Total size: ${totalSize}`,
      );
    }
  }

  return { totalFiles, totalSize, totalVersions };
}

const getPackageDetailsCommand = createBaseCommand({
  name: 'get-package-details',
  description: 'Get packages in a repository',
})
  .option(
    '--package-type <packageType>',
    'The type of package to find',
    'maven',
  )
  .option(
    '--organization <organization>',
    'The organization to get packages from',
    'myorg',
  )
  .option(
    '--csv-output <csvOutput>',
    'Path to write CSV output file',
    './package-details.csv',
  )
  .option(
    '--summary-output <summaryOutput>',
    'Path to write summary output file',
    './package-summary.txt',
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting get package details...');

      const organization = opts.orgName;
      const packageType = options.packageType.toUpperCase();
      const csvOutput = path.resolve(options.csvOutput);
      const summaryOutput = path.resolve(options.summaryOutput);

      logger.info(`Fetching packages for organization: ${organization}`);
      logger.info(`Package type: ${packageType}`);

      fs.writeFileSync(csvOutput, getCSVHeaders() + '\n');
      logger.info(`Created CSV file with headers at ${csvOutput}`);

      let packageCount = 0;
      let skippedCount = 0;
      let totalSizeBytes = 0;

      for await (const pkg of getOrgPackageDetails(
        octokit,
        organization,
        packageType,
        logger,
        opts.pageSize,
      )) {
        if (pkg.name.startsWith('deleted_') && pkg.versions.totalCount === 0) {
          logger.info(`Skipping package ${pkg.name} because it is deleted`);
          skippedCount++;
          continue;
        }

        // Fetch detailed package version information
        logger.info(
          `Fetching detailed version information for package: ${pkg.name}`,
        );
        const { totalFiles, totalSize, totalVersions } =
          await getPackageVersionDetails(
            octokit,
            organization,
            pkg.name,
            logger,
            opts.pageSize,
          );

        const csvRow = packageToCSVRow(
          pkg,
          totalFiles,
          totalSize,
          totalVersions,
        );
        fs.appendFileSync(csvOutput, csvRow + '\n');

        totalSizeBytes += totalSize;

        packageCount++;
        if (packageCount % 100 === 0) {
          logger.info(`Processed ${packageCount} packages so far`);
        }
      }

      logger.info(
        `Total packages retrieved and written to CSV: ${packageCount}`,
      );

      if (packageCount === 0) {
        logger.info('No packages found');
      } else {
        logger.info(`CSV data written incrementally to ${csvOutput}`);
      }

      // Create and write summary report
      const currentDate = new Date().toISOString().split('T')[0];

      const summaryContent = `Summary Report
=============
Date: ${currentDate}
Organization: ${organization}
Total Packages Written to CSV: ${packageCount}
Total Packages Skipped (deleted): ${skippedCount}
Total Size (bytes): ${totalSizeBytes}
Total Size (formatted): ${filesize(totalSizeBytes)}
`;

      fs.writeFileSync(summaryOutput, summaryContent);
      logger.info(`Summary report written to ${summaryOutput}`);
    });
  });

function packageToCSVRow(
  pkg: PackageDetail,
  totalFiles: number,
  totalSize: number,
  totalVersions: number,
): string {
  const repoName = pkg.repository ? pkg.repository.name : 'N/A';
  const isArchived = pkg.repository ? pkg.repository.isArchived : false;
  const visibility = pkg.repository ? pkg.repository.visibility : 'N/A';
  const downloads = pkg.statistics ? pkg.statistics.downloadsTotalCount : 0;
  const version = pkg.latestVersion ? pkg.latestVersion.version : 'N/A';

  // Get latest version update date for reference
  const updatedAt =
    pkg.latestVersion &&
    pkg.latestVersion.files &&
    pkg.latestVersion.files.nodes.length > 0
      ? pkg.latestVersion.files.nodes[0].updatedAt
      : 'N/A';

  return [
    pkg.name,
    pkg.packageType,
    repoName,
    isArchived,
    visibility,
    downloads,
    updatedAt,
    totalVersions, // Use calculated total versions instead of pkg.versions.totalCount
    version,
    totalFiles, // Use calculated total number of files
    totalSize, // Use calculated total size in bytes
    filesize(totalSize), // Format the total size for human readability
    totalSize, // Redundant column for backward compatibility
    filesize(totalSize), // Redundant column for backward compatibility
  ].join(',');
}

function getCSVHeaders(): string {
  return [
    'Package Name',
    'Package Type',
    'Repo Name',
    'Repo Archived',
    'Repo Visibility',
    'Downloads Count',
    'Last Published',
    'Total Versions',
    'Latest Version',
    'Asset Count',
    'File Size (bytes)',
    'File Size',
    'Total Size (bytes/estimated)',
    'Total Size (estimated)',
  ].join(',');
}

export default getPackageDetailsCommand;
