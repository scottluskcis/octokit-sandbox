import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import { filesize } from 'filesize';

interface PackageVersion {
  id: number;
  name: string;
  url: string;
  package_html_url: string;
  created_at: string;
  updated_at: string;
  html_url?: string;
  license?: string;
  description?: string;
  deleted_at?: string;
  metadata?: {
    container?: {
      tags?: string[];
    };
    package_type?: string;
  };
  size?: number;
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
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting find packages...');

      const orgPackagesIterator = octokit.paginate.iterator(
        'GET /orgs/{org}/packages',
        {
          org: opts.orgName,
          package_type: options.packageType,
          per_page: 100,
        },
      );

      /*
      I need to get the following information for each package:
        Repo
        Repo archive state
        Size of latest version package artifacts (combined)
        Size of all versions of the package artifacts (combined)
        Number of downloads
        Last publish date
        Last download date
      */

      const packageDetails = [];
      let totalPackages = 0;
      let totalSize = 0;

      for await (const { data: packages } of orgPackagesIterator) {
        logger.info(`Found ${packages.length} packages in the organization`);
        totalPackages += packages.length;

        for (const pkg of packages) {
          try {
            // Get package name and repository info
            const packageName = pkg.name;
            const packageType = pkg.package_type;
            const repositoryName = pkg.repository?.name || 'N/A';

            // Get additional package details
            const packageVersionsIterator = octokit.paginate.iterator(
              'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
              {
                org: opts.orgName,
                package_type: options.packageType,
                package_name: packageName,
                per_page: 100,
              },
            );

            let allVersionsSize = 0;
            let latestVersionSize = 0;
            let lastPublishDate = null;
            let totalDownloads = 0;
            let lastDownloadDate = null;
            let versions: PackageVersion[] = [];

            for await (const {
              data: packageVersions,
            } of packageVersionsIterator) {
              versions = [...versions, ...packageVersions];
            }

            // Sort by created_at to find the latest version
            versions.sort(
              (a, b) =>
                new Date(b.created_at).getTime() -
                new Date(a.created_at).getTime(),
            );

            if (versions.length > 0) {
              lastPublishDate = versions[0].created_at;

              // Calculate sizes
              for (const version of versions) {
                if (version.metadata?.container?.tags?.includes('latest')) {
                  latestVersionSize = version.size || 0;
                }
                allVersionsSize += version.size || 0;
              }

              // Add to total size
              totalSize += allVersionsSize;
            }

            // Get repository archived state
            let repoArchiveState = false;
            if (repositoryName !== 'N/A') {
              try {
                const { data: repoData } = await octokit.rest.repos.get({
                  owner: opts.orgName,
                  repo: repositoryName,
                });
                repoArchiveState = repoData.archived || false;
              } catch (error) {
                logger.warn(
                  `Failed to get repo information for ${repositoryName}: ${error}`,
                );
              }
            }

            // Get download information - Note: GitHub API might not provide direct download stats
            // You might need to use package-specific endpoints for this information
            // For example, for npm packages:
            try {
              // This is just an example - GitHub API does not directly provide download stats
              // You might need to use package registry-specific APIs
              const { data: downloadStats } = await octokit.request(
                'GET /orgs/{org}/packages/{package_type}/{package_name}/statistics',
                {
                  org: opts.orgName,
                  package_type: options.packageType,
                  package_name: packageName,
                },
              );
              totalDownloads = downloadStats?.downloads || 0;
              lastDownloadDate = downloadStats?.last_download_date || null;
            } catch (error) {
              logger.warn(
                `Failed to get download stats for ${packageName}: ${error}`,
              );
            }

            packageDetails.push({
              name: packageName,
              type: packageType,
              repository: repositoryName,
              repositoryArchived: repoArchiveState,
              latestVersionSize,
              allVersionsSize,
              totalDownloads,
              lastPublishDate,
              lastDownloadDate,
              versionCount: versions.length,
            });

            logger.info(`Processed package: ${packageName}`);
          } catch (error) {
            logger.error(`Error processing package ${pkg.name}: ${error}`);
          }
        }
      }

      // Output package details
      logger.info('Package Details:');
      console.table(packageDetails);

      // Report totals using filesize library instead of custom formatter
      logger.info(`Total Packages: ${totalPackages}`);
      logger.info(`Total Size of All Packages: ${filesize(totalSize)}`);

      logger.info('Finished find packages');
    });
  });

export default findPackagesCommand;
