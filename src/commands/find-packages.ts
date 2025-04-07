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

interface PackageSizeAndDateInfo {
  latestVersionSize: number;
  allVersionsSize: number;
  lastPublishDate: string | null;
  lastDownloadDate: string | null;
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

    // For size information and dates, we'll need to make separate REST API calls
    const sizeAndDateInfo = await getPackageSizeAndDateInfo(
      octokit,
      orgName,
      packageType,
      packageName,
      logger,
    );

    return {
      repositoryName,
      repositoryArchived,
      latestVersionSize: sizeAndDateInfo.latestVersionSize,
      allVersionsSize: sizeAndDateInfo.allVersionsSize,
      totalDownloads,
      lastPublishDate: sizeAndDateInfo.lastPublishDate,
      lastDownloadDate: sizeAndDateInfo.lastDownloadDate,
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
 * Gets package size and date information using REST API
 */
async function getPackageSizeAndDateInfo(
  octokit: any,
  orgName: string,
  packageType: string,
  packageName: string,
  logger: any,
): Promise<PackageSizeAndDateInfo> {
  try {
    // Get package versions to calculate sizes and determine dates
    const versionsResponse = await octokit.request(
      'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
      {
        org: orgName,
        package_type: packageType,
        package_name: packageName,
        per_page: 100,
        state: 'active', // Only include active versions
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    // Access data correctly from the response
    const versions = versionsResponse.data || [];

    let allVersionsSize = 0;
    let latestVersionSize = 0;
    let lastPublishDate: string | null = null;
    let lastDownloadDate: string | null = null;

    logger.debug(
      `Retrieved ${versions.length} versions for package ${packageName}`,
    );

    // Find the latest version and calculate total size
    if (versions.length > 0) {
      // Sort by created_at to find the latest version
      const sortedVersions = [...versions].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      // Latest version is the first in the sorted array
      const latestVersion = sortedVersions[0];
      latestVersionSize = latestVersion.size || 0;
      lastPublishDate = latestVersion.created_at || null;

      // Calculate total size of all versions
      for (const version of versions) {
        // Debug the version size information
        logger.debug(
          `Package ${packageName} version ${version.name}: size = ${version.size}`,
        );
        if (typeof version.size === 'number') {
          allVersionsSize += version.size;
        }
      }

      // If we still can't get last download date, use a different approach
      if (!lastDownloadDate) {
        try {
          // Try to get overall package download information - this is a separate endpoint
          const downloadInfo = await fetchLastDownloadDate(
            octokit,
            orgName,
            packageType,
            packageName,
            logger,
          );
          lastDownloadDate = downloadInfo || null;
        } catch (dlError) {
          logger.debug(
            `Could not get download info for package ${packageName}: ${dlError instanceof Error ? dlError.message : String(dlError)}`,
          );
        }
      }
    }

    // If we still don't have size info, check download logs
    if (allVersionsSize === 0) {
      // Try alternate method to get size - check version assets directly
      try {
        const versionIds = versions.map((v: any) => v.id);
        if (versionIds.length > 0) {
          const updatedSizeInfo = await getDetailedVersionSizes(
            octokit,
            orgName,
            packageType,
            packageName,
            versionIds,
            logger,
          );

          if (updatedSizeInfo.allVersionsSize > 0) {
            allVersionsSize = updatedSizeInfo.allVersionsSize;
            latestVersionSize =
              updatedSizeInfo.latestVersionSize || latestVersionSize;
          }
        }
      } catch (sizeError) {
        logger.debug(
          `Failed to get detailed size info for ${packageName}: ${sizeError instanceof Error ? sizeError.message : String(sizeError)}`,
        );
      }
    }

    logger.debug(
      `Package ${packageName} - allVersionsSize: ${allVersionsSize}, lastDownloadDate: ${lastDownloadDate || 'N/A'}`,
    );

    return {
      latestVersionSize,
      allVersionsSize,
      lastPublishDate,
      lastDownloadDate,
    };
  } catch (error) {
    logger.warn(
      `Failed to get size and date info for package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      latestVersionSize: 0,
      allVersionsSize: 0,
      lastPublishDate: null,
      lastDownloadDate: null,
    };
  }
}

/**
 * Try to get download metrics for a specific package version
 * Note: This is an attempt to get last download date but may not work for all package types
 */
async function getVersionDownloadMetrics(
  octokit: any,
  orgName: string,
  packageType: string,
  packageName: string,
  versionId: number,
  logger: any,
): Promise<{ lastDownloadDate: string | null } | null> {
  try {
    // This endpoint might not exist for all package types
    // We're making a best effort attempt to find download metrics
    const response = await octokit.request(
      'GET /orgs/{org}/packages/{package_type}/{package_name}/versions/{version_id}/downloads',
      {
        org: orgName,
        package_type: packageType,
        package_name: packageName,
        version_id: versionId,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    // Parse the response to find the most recent download date
    if (response.data && Array.isArray(response.data)) {
      const downloads = response.data;
      if (downloads.length > 0) {
        // Sort downloads by date (newest first)
        const sortedDownloads = [...downloads].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );

        // Return the most recent download date
        return { lastDownloadDate: sortedDownloads[0].timestamp };
      }
    }

    return null;
  } catch (error) {
    // This endpoint might not exist or might not be accessible
    logger.debug(
      `Could not get download metrics for version ${versionId} of package ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
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
 * Attempts to retrieve the last download date for a package using multiple strategies
 */
async function fetchLastDownloadDate(
  octokit: any,
  orgName: string,
  packageType: string,
  packageName: string,
  logger: any,
): Promise<string | null> {
  // Strategy 1: Try to get package traffic data (if available)
  try {
    const response = await octokit.request(
      'GET /orgs/{org}/packages/{package_type}/{package_name}/traffic',
      {
        org: orgName,
        package_type: packageType,
        package_name: packageName,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (response.data && response.data.last_downloaded_at) {
      return response.data.last_downloaded_at;
    }
  } catch (error) {
    // This endpoint might not exist; continue to next strategy
    logger.debug(`Traffic data not available for ${packageName}`);
  }

  // Strategy 2: For container packages, check container download logs
  if (packageType === 'container') {
    try {
      const response = await octokit.request(
        'GET /orgs/{org}/packages/{package_type}/{package_name}/download-logs',
        {
          org: orgName,
          package_type: packageType,
          package_name: packageName,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );

      if (response.data && response.data.length > 0) {
        // Sort logs by date (newest first)
        const sortedLogs = [...response.data].sort(
          (a, b) =>
            new Date(b.date || b.downloaded_at).getTime() -
            new Date(a.date || a.downloaded_at).getTime(),
        );

        // Return the most recent date
        return sortedLogs[0].date || sortedLogs[0].downloaded_at;
      }
    } catch (error) {
      logger.debug(`Download logs not available for container ${packageName}`);
    }
  }

  // Strategy 3: Try to get info from log files (especially for Maven packages)
  if (packageType === 'maven') {
    try {
      // Look for logs that might contain download information for this package
      // First, check if log files exist
      const fs = require('fs');
      const path = require('path');
      const logsDir = path.resolve('./logs');

      if (fs.existsSync(logsDir)) {
        const logFiles = fs
          .readdirSync(logsDir)
          .filter((file: string) => file.endsWith('.log'))
          .sort((a: string, b: string) => {
            // Sort by date in filename (if present) or by modification time
            const aMatch = a.match(/(\d{4}-\d{2}-\d{2})/);
            const bMatch = b.match(/(\d{4}-\d{2}-\d{2})/);

            if (aMatch && bMatch) {
              return (
                new Date(bMatch[1]).getTime() - new Date(aMatch[1]).getTime()
              );
            }

            const aStats = fs.statSync(path.join(logsDir, a));
            const bStats = fs.statSync(path.join(logsDir, b));
            return bStats.mtime.getTime() - aStats.mtime.getTime();
          });

        // Check most recent logs first
        for (const logFile of logFiles.slice(0, 2)) {
          // Only check the 2 most recent
          const logPath = path.join(logsDir, logFile);
          const content = fs.readFileSync(logPath, 'utf-8');

          // Look for pattern indicating package download
          const pattern = new RegExp(
            `package\\s+${packageName}.*downloaded|${packageName}.*download`,
            'i',
          );
          if (pattern.test(content)) {
            // Try to extract a date from the log
            const dateMatch = content.match(
              /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/,
            );
            if (dateMatch) {
              return dateMatch[1];
            }

            // If no date in content, use log file date
            if (logFile.includes('2025') || logFile.includes('2024')) {
              // Extract date from filename or use file date
              const dateInFilename = logFile.match(/(\d{4}-\d{2}-\d{2})/);
              if (dateInFilename) {
                return `${dateInFilename[1]}T00:00:00Z`;
              }
            }
          }
        }
      }
    } catch (logError) {
      logger.debug(
        `Error checking log files: ${logError instanceof Error ? logError.message : String(logError)}`,
      );
    }
  }

  // Strategy 4: Estimate based on popular versions (for npm packages)
  if (packageType === 'npm') {
    try {
      // For npm, check the npm registry directly (if exposed)
      const response = await octokit.request(
        'GET /orgs/{org}/packages/{package_type}/{package_name}/npm-metadata',
        {
          org: orgName,
          package_type: packageType,
          package_name: packageName,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );

      if (response.data && response.data.time && response.data.time.modified) {
        return response.data.time.modified;
      }
    } catch (error) {
      logger.debug(`NPM metadata not available for ${packageName}`);
    }
  }

  // Strategy 5: Fall back to using the most recent version's publish date
  try {
    const versionsResponse = await octokit.request(
      'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
      {
        org: orgName,
        package_type: packageType,
        package_name: packageName,
        per_page: 10, // Only need a few to find most recent
        state: 'active',
        sort: 'created',
        direction: 'desc',
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );

    if (versionsResponse.data && versionsResponse.data.length > 0) {
      // Use the first version's date as an approximation
      // Not perfect, but better than null
      return versionsResponse.data[0].created_at;
    }
  } catch (error) {
    logger.debug(
      `Could not get versions for fallback date: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // If all strategies fail, return null
  return null;
}

/**
 * Gets detailed version sizes by checking version assets directly
 * This is a more comprehensive approach to get package sizes
 */
async function getDetailedVersionSizes(
  octokit: any,
  orgName: string,
  packageType: string,
  packageName: string,
  versionIds: number[],
  logger: any,
): Promise<PackageSizeInfo> {
  let allVersionsSize = 0;
  let latestVersionSize = 0;
  let latestVersionId = versionIds[0]; // Assume first ID is the latest unless we find otherwise

  try {
    // For Maven packages, we need to check each version's assets
    for (const versionId of versionIds) {
      try {
        // Fetch version details including assets
        const versionResponse = await octokit.request(
          'GET /orgs/{org}/packages/{package_type}/{package_name}/versions/{version_id}',
          {
            org: orgName,
            package_type: packageType,
            package_name: packageName,
            version_id: versionId,
            headers: {
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        );

        const version = versionResponse.data;
        let versionSize = 0;

        // Check if version has a size property
        if (typeof version.size === 'number' && version.size > 0) {
          versionSize = version.size;
        } else if (version.assets && Array.isArray(version.assets)) {
          // Sum up the size of all assets
          versionSize = version.assets.reduce(
            (sum: number, asset: any) => sum + (asset.size || 0),
            0,
          );
        }

        // Add to total size
        allVersionsSize += versionSize;

        // Track latest version (assuming sorted by ID or checking created_at)
        if (
          versionId === latestVersionId ||
          (version.created_at &&
            new Date(version.created_at).getTime() > latestVersionSize)
        ) {
          latestVersionSize = versionSize;
          latestVersionId = versionId;
        }

        logger.debug(`Version ${versionId} size: ${versionSize} bytes`);
      } catch (error) {
        logger.debug(
          `Could not get details for version ${versionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Fall back to estimating sizes from package repository if still zero
    if (allVersionsSize === 0 && packageType === 'maven') {
      try {
        // Try to get repository size from GraphQL
        const query = `
          query getRepoSize($org: String!, $packageName: String!) {
            organization(login: $org) {
              repository(name: $packageName) {
                diskUsage
              }
            }
          }
        `;

        const result = await octokit.graphql(query, {
          org: orgName,
          packageName: packageName.split('.').pop() || packageName, // Try to extract repo name from package name
        });

        if (result.organization?.repository?.diskUsage) {
          // Convert KB to bytes
          allVersionsSize = result.organization.repository.diskUsage * 1024;
          latestVersionSize = Math.floor(allVersionsSize / versionIds.length); // Estimate
          logger.debug(
            `Used repository size as fallback: ${allVersionsSize} bytes`,
          );
        }
      } catch (repoError) {
        logger.debug(
          `Could not get repository size: ${repoError instanceof Error ? repoError.message : String(repoError)}`,
        );
      }
    }

    return { latestVersionSize, allVersionsSize };
  } catch (error) {
    logger.warn(
      `Error in getDetailedVersionSizes for ${packageName}: ${error instanceof Error ? error.message : String(error)}`,
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

/*
versions(last: 1, orderBy: {field: CREATED_AT, direction: ASC}) {
					nodes {
						files(last: 1) {
							nodes {
								name
								size
								updatedAt 
							}
						}
						version
					}
				}
*/
