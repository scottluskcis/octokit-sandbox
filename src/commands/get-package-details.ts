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

// const PACKAGE_VERSIONS_QUERY = `
// query($organization: String!, $packageName: String!, $pageSize: Int!, $endCursor: String) {
//   organization(login: $organization) {
//     packages(first: 1, names: [$packageName]) {
//       nodes {
//         versions(first: $pageSize, after: $endCursor) {
//           nodes {
//             files(first: 100) {
//               nodes {
//                 size
//               }
//               totalCount
//             }
//           }
//           pageInfo {
//             hasNextPage
//             endCursor
//           }
//         }
//       }
//     }
//   }
// }`;

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
        if (pkg.name.startsWith('deleted_') && pkg.versions.totalCount === 0) {
          logger.info(`Skipping package ${pkg.name} because it is deleted`);
          continue;
        }

        const csvRow = packageToCSVRow(pkg);
        fs.appendFileSync(csvOutput, csvRow + '\n');

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

function packageToCSVRow(pkg: PackageDetail): string {
  const repoName = pkg.repository ? pkg.repository.name : 'N/A';
  const isArchived = pkg.repository ? pkg.repository.isArchived : false;
  const visibility = pkg.repository ? pkg.repository.visibility : 'N/A';
  const downloads = pkg.statistics ? pkg.statistics.downloadsTotalCount : 0;
  const version = pkg.latestVersion ? pkg.latestVersion.version : 'N/A';

  const allFiles =
    pkg.latestVersion &&
    pkg.latestVersion.files &&
    pkg.latestVersion.files.nodes
      ? pkg.latestVersion.files.nodes
      : [];

  const assetCount = allFiles.length;
  const fileSize =
    allFiles.length > 0
      ? allFiles.reduce((sum, file) => sum + file.size, 0)
      : 'N/A';
  const updatedAt = allFiles.length > 0 ? allFiles[0].updatedAt : 'N/A';
  const totalVersions = pkg.versions ? pkg.versions.totalCount : 0;
  const totalSize = fileSize != 'N/A' ? fileSize * totalVersions : 0;

  return [
    pkg.name,
    pkg.packageType,
    repoName,
    isArchived,
    visibility,
    downloads,
    updatedAt,
    totalVersions,
    version,
    assetCount,
    fileSize,
    fileSize != 'N/A' ? filesize(fileSize) : 0,
    totalSize,
    filesize(totalSize),
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
