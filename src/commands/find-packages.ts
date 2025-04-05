import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import { filesize } from 'filesize';
import * as fs from 'fs';
import * as path from 'path';

// Define types for better type safety
interface PackageDetail {
  name: string;
  type: string;
  repository: string;
  repositoryArchived: boolean;
  latestVersionSize: number;
  allVersionsSize: number;
  totalDownloads: number;
  lastPublishDate: string | null;
  lastDownloadDate: string | null;
  versionCount: number;
}

interface PackageDetailedInfo {
  repositoryName: string;
  repositoryArchived: boolean;
  latestVersionSize: number;
  allVersionsSize: number;
  totalDownloads: number;
  lastPublishDate: string | null;
  lastDownloadDate: string | null;
  versionCount: number;
}

interface PackageSizeInfo {
  latestVersionSize: number;
  allVersionsSize: number;
}

// Octokit types
interface OctokitResponse {
  data: any;
}

const findPackagesCommand = createBaseCommand({
  name: 'find-packages',
  description: 'Find packages in a repository',
})
  .option(
    '--package-type <packageType>',
    'The type of package to find',
    'maven',
  )
  .option(
    '--csv-output <csvOutput>',
    'Path to write CSV output file',
    './package-details.csv',
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting find packages...');

      // First use REST API to get all packages
      const packageDetails = await fetchPackagesWithHybridApproach(
        octokit,
        logger,
        opts,
        options,
      );

      // Output package details
      logger.info('Package Details:');
      console.table(packageDetails);

      // Write data to CSV file
      try {
        writeToCsv(packageDetails, options.csvOutput, logger);
        logger.info(`CSV file written successfully to: ${options.csvOutput}`);
      } catch (error) {
        logger.error(
          `Failed to write CSV file: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Calculate and report totals
      const totalPackages = packageDetails.length;
      const totalSize = packageDetails.reduce(
        (acc, pkg) => acc + (pkg.allVersionsSize || 0),
        0,
      );

      logger.info(`Total Packages: ${totalPackages}`);
      logger.info(`Total Size of All Packages: ${filesize(totalSize)}`);

      logger.info('Finished find packages');
    });
  });

/**
 * Fetches packages using a hybrid approach: REST API for package listing and GraphQL for detailed info
 */
async function fetchPackagesWithHybridApproach(
  octokit: any,
  logger: any,
  opts: any,
  options: any,
): Promise<PackageDetail[]> {
  logger.info('Using hybrid approach to fetch package information');
  const packageDetails: PackageDetail[] = [];
  let totalPackages = 0;

  try {
    // Use REST API with iterator to get all packages
    const orgPackagesIterator = octokit.paginate.iterator(
      'GET /orgs/{org}/packages',
      {
        org: opts.orgName,
        package_type: options.packageType,
        per_page: 100,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    for await (const { data: packages } of orgPackagesIterator) {
      logger.info(`Found ${packages.length} packages in this page`);
      totalPackages += packages.length;

      // Process each package individually
      for (const pkg of packages) {
        try {
          const packageName = pkg.name;
          const packageType = pkg.package_type;

          logger.info(`Processing package: ${packageName}`);

          // Get detailed information via GraphQL for this specific package
          const detailedInfo = await getPackageDetailedInfo(
            octokit,
            opts.orgName,
            packageType,
            packageName,
            logger,
          );

          packageDetails.push({
            name: packageName,
            type: packageType,
            repository: detailedInfo.repositoryName || 'N/A',
            repositoryArchived: detailedInfo.repositoryArchived || false,
            latestVersionSize: detailedInfo.latestVersionSize || 0,
            allVersionsSize: detailedInfo.allVersionsSize || 0,
            totalDownloads: detailedInfo.totalDownloads || 0,
            lastPublishDate: detailedInfo.lastPublishDate || pkg.created_at,
            lastDownloadDate: detailedInfo.lastDownloadDate || null,
            versionCount: detailedInfo.versionCount || 0,
          });
        } catch (error) {
          logger.error(
            `Error processing package ${pkg.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Add the package with basic info even if detailed info failed
          packageDetails.push({
            name: pkg.name,
            type: pkg.package_type,
            repository: pkg.repository?.name || 'N/A',
            repositoryArchived: false,
            latestVersionSize: 0,
            allVersionsSize: 0,
            totalDownloads: 0,
            lastPublishDate: pkg.created_at || null,
            lastDownloadDate: null,
            versionCount: 0,
          });
        }
      }
    }
  } catch (error) {
    logger.error(
      `Error fetching packages: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new Error(
      `Package fetching failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return packageDetails;
}

/**
 * Gets detailed package information using GraphQL for a specific package
 */
async function getPackageDetailedInfo(
  octokit: any,
  orgName: string,
  packageType: string,
  packageName: string,
  logger: any,
): Promise<PackageDetailedInfo> {
  // The GitHub GraphQL API uses 'packages' (plural) with a filter, not a single 'package' field
  const query = `
    query getPackageDetails($org: String!, $packageType: PackageType!, $packageName: String!) {
      organization(login: $org) {
        packages(first: 1, packageType: $packageType, names: [$packageName]) {
          nodes {
            name
            repository {
              name
              isArchived
            }
            versions(first: 100) {
              totalCount
              nodes {
                id
                version
                files {
                  totalCount
                }
                statistics {
                  downloadsTotalCount
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    // Execute GraphQL query for the specific package
    const result = await octokit.graphql(query, {
      org: orgName,
      packageType: packageType.toUpperCase(),
      packageName: packageName,
    });

    // Access the first package in the nodes array
    const packageData = result.organization.packages.nodes[0];

    // Check if package data exists
    if (!packageData) {
      logger.warn(`No GraphQL data found for package ${packageName}`);
      return {
        repositoryName: 'N/A',
        repositoryArchived: false,
        latestVersionSize: 0,
        allVersionsSize: 0,
        totalDownloads: 0,
        lastPublishDate: null,
        lastDownloadDate: null,
        versionCount: 0,
      };
    }

    // Process repository info
    const repositoryName = packageData.repository?.name || 'N/A';
    const repositoryArchived = packageData.repository?.isArchived || false;

    // Process versions info
    const versionCount = packageData.versions.totalCount;
    const versions = packageData.versions.nodes;

    // Calculate downloads
    let totalDownloads = 0;
    versions.forEach((version: any) => {
      if (version.statistics) {
        totalDownloads += version.statistics.downloadsTotalCount || 0;
      }
    });

    // For size information, we'll need to make separate REST API calls
    const sizeInfo = await getPackageSizeInfo(
      octokit,
      orgName,
      packageType,
      packageName,
      logger,
    );

    return {
      repositoryName,
      repositoryArchived,
      latestVersionSize: sizeInfo.latestVersionSize,
      allVersionsSize: sizeInfo.allVersionsSize,
      totalDownloads,
      lastPublishDate: null, // Not available in GraphQL
      lastDownloadDate: null, // Not available in GraphQL
      versionCount,
    };
  } catch (error) {
    logger.error(
      `GraphQL query failed for package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      repositoryName: 'N/A',
      repositoryArchived: false,
      latestVersionSize: 0,
      allVersionsSize: 0,
      totalDownloads: 0,
      lastPublishDate: null,
      lastDownloadDate: null,
      versionCount: 0,
    };
  }
}

/**
 * Gets package size information using REST API
 */
async function getPackageSizeInfo(
  octokit: any,
  orgName: string,
  packageType: string,
  packageName: string,
  logger: any,
): Promise<PackageSizeInfo> {
  try {
    // Get package versions to calculate sizes
    const versionsResponse = await octokit.paginate(
      'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
      {
        org: orgName,
        package_type: packageType,
        package_name: packageName,
        per_page: 100,
      },
    );

    let allVersionsSize = 0;
    let latestVersionSize = 0;

    // Find the latest version and calculate total size
    if (versionsResponse.length > 0) {
      // Sort by created_at to find the latest version
      const sortedVersions = [...versionsResponse].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      // Latest version is the first in the sorted array
      latestVersionSize = sortedVersions[0].size || 0;

      // Calculate total size of all versions
      for (const version of versionsResponse) {
        allVersionsSize += version.size || 0;
      }
    }

    return { latestVersionSize, allVersionsSize };
  } catch (error) {
    logger.warn(
      `Failed to get size info for package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { latestVersionSize: 0, allVersionsSize: 0 };
  }
}

/**
 * Writes package details to a CSV file
 * @param data The package details to write
 * @param filePath The path to the output CSV file
 * @param logger The logger instance
 */
function writeToCsv(
  data: PackageDetail[],
  filePath: string,
  logger: any,
): void {
  if (!data || data.length === 0) {
    logger.warn('No data to write to CSV file');
    return;
  }

  // Ensure directory exists
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  // Get headers from the first object
  const headers = Object.keys(data[0]);

  // Create CSV content with headers
  let csvContent = headers.join(',') + '\n';

  // Add data rows
  data.forEach((row: PackageDetail) => {
    const values = headers.map((header) => {
      const value = row[header as keyof PackageDetail];

      // Handle special cases (null, undefined, objects, etc.)
      if (value === null || value === undefined) {
        return '';
      }

      // Format date fields
      if (header.includes('Date') && value) {
        return `"${new Date(value as string).toISOString()}"`;
      }

      // Format size fields with filesize
      if (header.includes('Size') && typeof value === 'number') {
        return `"${filesize(value)}"`;
      }

      // Escape string values that contain commas or quotes
      if (typeof value === 'string') {
        return `"${value.replace(/"/g, '""')}"`;
      }

      return value;
    });

    csvContent += values.join(',') + '\n';
  });

  // Write to file
  fs.writeFileSync(filePath, csvContent, 'utf8');
}

export default findPackagesCommand;
