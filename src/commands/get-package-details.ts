import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import fs from 'fs';
import path from 'path';

// Define interfaces for the GraphQL response
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

interface Package {
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
}

interface PackagesResponse {
  organization: {
    packages: {
      nodes: Package[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
}

// GraphQL query for package details
const PACKAGE_DETAILS_QUERY = `
query($organization: String!, $packageType: PackageType!, $endCursor: String) {
  organization(login: $organization) {
    packages(last: 100, packageType: $packageType, after: $endCursor) {
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
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

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

      const allPackages: Package[] = [];
      let hasNextPage = true;
      let endCursor: string | null = null;

      // Paginate through all results
      while (hasNextPage) {
        logger.info(
          `Fetching page${endCursor ? ' after cursor: ' + endCursor : ''}...`,
        );

        const result: PackagesResponse =
          await octokit.graphql<PackagesResponse>(PACKAGE_DETAILS_QUERY, {
            organization,
            packageType,
            endCursor,
          });

        const packages = result.organization.packages.nodes;
        const { hasNextPage: nextPage, endCursor: nextCursor } =
          result.organization.packages.pageInfo;

        logger.info(`Retrieved ${packages.length} packages`);
        allPackages.push(...packages);

        hasNextPage = nextPage;
        endCursor = nextCursor;
      }

      logger.info(`Total packages retrieved: ${allPackages.length}`);

      // Process and write to CSV
      if (allPackages.length > 0) {
        const csvData = convertToCSV(allPackages);
        fs.writeFileSync(csvOutput, csvData);
        logger.info(`CSV data written to ${csvOutput}`);
      } else {
        logger.info('No packages found');
      }
    });
  });

// Helper function to convert package data to CSV
function convertToCSV(packages: Package[]): string {
  const headers = [
    'Name',
    'Package Type',
    'Repository',
    'Is Archived',
    'Downloads Count',
    'Latest Version',
    'Latest File',
    'File Size (bytes)',
    'Last Updated',
  ].join(',');

  const rows = packages.map((pkg) => {
    const repoName = pkg.repository ? pkg.repository.name : 'N/A';
    const isArchived = pkg.repository ? pkg.repository.isArchived : false;
    const downloads = pkg.statistics ? pkg.statistics.downloadsTotalCount : 0;
    const version = pkg.latestVersion ? pkg.latestVersion.version : 'N/A';

    // Get the first file if it exists
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
    ].join(',');
  });

  return [headers, ...rows].join('\n');
}

export default getPackageDetailsCommand;
