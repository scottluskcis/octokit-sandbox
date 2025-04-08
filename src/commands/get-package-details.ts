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

interface PackageVersionsResponse {
  organization: {
    packages: {
      nodes: {
        versions: {
          nodes: { files: { nodes: { size: number }[] } }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }[];
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
        }
        statistics {
          downloadsTotalCount 
        }
        latestVersion { 
          files(last: 1, orderBy: {field: CREATED_AT, direction: ASC}) {
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
            files(first: 100) {  
              nodes {
                size
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

async function getTotalPackageVersionsSize(
  octokit: Octokit,
  organization: string,
  packageName: string,
  logger: any,
  pageSize: number = 100,
  endCursor: string | null = null,
): Promise<number> {
  let totalFetched = 0;
  let pageCount = 0;
  let hasNextPage = true;
  let currentCursor = endCursor;
  let totalSize = 0;

  while (hasNextPage) {
    pageCount++;
    logger.info(
      `Fetching page ${pageCount} with cursor: ${currentCursor || 'initial'}`,
    );

    try {
      const response = await octokit.graphql<PackageVersionsResponse>(
        PACKAGE_VERSIONS_QUERY,
        {
          organization,
          packageName,
          pageSize,
          endCursor: currentCursor,
        },
      );

      if (!response.organization || !response.organization.packages.nodes[0]) {
        logger.error(
          `GraphQL response is missing expected data. Response: ${JSON.stringify(response)}`,
        );
        break; // Exit loop if data is missing
      }

      const versions =
        response.organization.packages.nodes[0].versions.nodes || [];
      const pageInfo =
        response.organization.packages.nodes[0].versions.pageInfo;

      if (!versions || versions.length === 0) {
        logger.warn(`No versions found for package: ${packageName}`);
        break; // Exit loop if no versions are found
      }

      totalFetched += versions.length;

      // Sum up file sizes from all versions
      for (const version of versions) {
        if (version.files && version.files.nodes) {
          for (const file of version.files.nodes) {
            totalSize += file.size || 0;
          }
        }
      }

      hasNextPage = pageInfo.hasNextPage;
      currentCursor = pageInfo.endCursor;

      if (!hasNextPage) {
        logger.info(
          `Reached final page. Total versions fetched: ${totalFetched}`,
        );
      }
    } catch (error) {
      logger.error(
        `Error fetching package versions for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
      );
      break; // Exit loop on error
    }
  }
  return totalSize;
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
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting get package details...');

      const organization = opts.orgName;
      const packageType = options.packageType.toUpperCase();
      const csvOutput = path.resolve(options.csvOutput);

      logger.info(`Fetching packages for organization: ${organization}`);
      logger.info(`Package type: ${packageType}`);

      fs.writeFileSync(csvOutput, getCSVHeaders() + '\n');
      logger.info(`Created CSV file with headers at ${csvOutput}`);

      let packageCount = 0;

      for await (const pkg of getOrgPackageDetails(
        octokit,
        organization,
        packageType,
        logger,
        opts.pageSize,
      )) {
        const totalSize =
          pkg.versions.totalCount > 0
            ? await getTotalPackageVersionsSize(
                octokit,
                organization,
                pkg.name,
                logger,
                opts.pageSize,
              )
            : 0;

        const csvRow = packageToCSVRow(pkg, totalSize);
        fs.appendFileSync(csvOutput, csvRow + '\n');

        logger.info(
          `Total size of all versions for package ${pkg.name}: ${totalSize} bytes`,
        );

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
    });
  });

function packageToCSVRow(pkg: PackageDetail, totalSize: number): string {
  const repoName = pkg.repository ? pkg.repository.name : 'N/A';
  const isArchived = pkg.repository ? pkg.repository.isArchived : false;
  const downloads = pkg.statistics ? pkg.statistics.downloadsTotalCount : 0;
  const version = pkg.latestVersion ? pkg.latestVersion.version : 'N/A';

  const fileInfo =
    pkg.latestVersion &&
    pkg.latestVersion.files &&
    pkg.latestVersion.files.nodes &&
    pkg.latestVersion.files.nodes.length > 0
      ? pkg.latestVersion.files.nodes[0]
      : null;

  const fileName = fileInfo ? fileInfo.name : 'N/A';
  const fileSize = fileInfo ? fileInfo.size : 'N/A';
  const updatedAt = fileInfo ? fileInfo.updatedAt : 'N/A';
  const totalVersions = pkg.versions ? pkg.versions.totalCount : 0;

  return [
    pkg.name,
    pkg.packageType,
    repoName,
    isArchived,
    downloads,
    version,
    fileName,
    fileSize,
    updatedAt,
    totalVersions,
    filesize(totalSize),
  ].join(',');
}

function getCSVHeaders(): string {
  return [
    'Name',
    'Package Type',
    'Repository',
    'Is Archived',
    'Downloads Count',
    'Latest Version',
    'Latest File',
    'File Size (bytes)',
    'Last Updated',
    'Total Versions',
    'Total Size',
  ].join(',');
}

export default getPackageDetailsCommand;
