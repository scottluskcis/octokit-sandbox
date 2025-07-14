import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';

import { Octokit } from 'octokit';
import fs from 'fs';
import path from 'path';

interface CodespaceMachine {
  name: string;
  displayName: string;
  cpuSize: number;
  memorySize: number;
  storage: number;
}

interface CodespaceOwner {
  login: string;
}

interface Codespace {
  name: string;
  state: string;
  machine: CodespaceMachine | null;
  billableOwner: CodespaceOwner | null;
  owner: CodespaceOwner | null;
  repository: {
    name: string;
  } | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface CodespacesConnection {
  totalCount: number;
  nodes: Codespace[];
}

interface Repository {
  name: string;
  codespaces: CodespacesConnection;
}

async function* getCodespaceUsage(
  octokit: Octokit,
  organization: string,
  logger: any,
  pageSize: number = 100,
): AsyncGenerator<Repository, void, unknown> {
  let totalFetched = 0;
  let pageCount = 0;

  try {
    const codespacesIterator = octokit.paginate.iterator(
      'GET /orgs/{org}/codespaces',
      {
        org: organization,
        per_page: pageSize,
      },
    );

    for await (const { data: codespaces } of codespacesIterator) {
      pageCount++;
      logger.info(`Fetching page ${pageCount}`);
      logger.info(`Retrieved ${codespaces.length} codespaces from API`);

      // Group codespaces by repository
      const repositoryMap = new Map<string, Codespace[]>();
      for (const codespace of codespaces) {
        const repoName = codespace.repository?.name || 'Unknown';

        // Convert REST API response to our interface format
        const convertedCodespace: Codespace = {
          name: codespace.name,
          state: codespace.state,
          machine: codespace.machine
            ? {
                name: codespace.machine.name,
                displayName: codespace.machine.display_name,
                cpuSize: codespace.machine.cpus,
                memorySize:
                  codespace.machine.memory_in_bytes / (1024 * 1024 * 1024), // Convert bytes to GB
                storage:
                  codespace.machine.storage_in_bytes / (1024 * 1024 * 1024), // Convert bytes to GB
              }
            : null,
          billableOwner: codespace.billable_owner
            ? {
                login: codespace.billable_owner.login,
              }
            : null,
          owner: codespace.owner
            ? {
                login: codespace.owner.login,
              }
            : null,
          repository: codespace.repository
            ? {
                name: codespace.repository.name,
              }
            : null,
          lastUsedAt: codespace.last_used_at,
          createdAt: codespace.created_at,
        };

        if (!repositoryMap.has(repoName)) {
          repositoryMap.set(repoName, []);
        }
        repositoryMap.get(repoName)!.push(convertedCodespace);
      }

      // Convert to Repository objects
      const repositories: Repository[] = Array.from(
        repositoryMap.entries(),
      ).map(([name, codespaces]) => ({
        name,
        codespaces: {
          totalCount: codespaces.length,
          nodes: codespaces,
        },
      }));

      totalFetched += repositories.length;
      logger.info(
        `Page ${pageCount}: Retrieved ${repositories.length} repositories (${totalFetched} total so far)`,
      );

      for (const repo of repositories) {
        yield repo;
      }
    }

    logger.info(
      `Reached final page. Total repositories fetched: ${totalFetched}`,
    );
  } catch (error: any) {
    logger.error(`Error fetching codespaces: ${error.message}`);
    if (error.status === 404) {
      logger.warn(
        `Organization ${organization} not found or codespaces not accessible`,
      );
    }
  }
}

function repositoryToCSVRow(repo: Repository): string[] {
  const rows: string[] = [];

  if (repo.codespaces.totalCount === 0) {
    // If no codespaces, create one row with repository info only
    rows.push(
      [
        repo.name,
        //'0',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
      ].join(','),
    );
  } else {
    // Create a row for each codespace
    for (const codespace of repo.codespaces.nodes) {
      const machineName = codespace.machine ? codespace.machine.name : 'N/A';
      // const machineDisplayName = codespace.machine
      //   ? codespace.machine.displayName.replace(',', ' ')
      //   : 'N/A';
      const cpuSize = codespace.machine
        ? codespace.machine.cpuSize.toString()
        : 'N/A';
      const memorySize = codespace.machine
        ? codespace.machine.memorySize.toString()
        : 'N/A';
      const storage = codespace.machine
        ? codespace.machine.storage.toString()
        : 'N/A';
      const billableOwner = codespace.billableOwner
        ? codespace.billableOwner.login
        : 'N/A';
      const owner = codespace.owner ? codespace.owner.login : 'N/A';

      rows.push(
        [
          repo.name,
          //repo.codespaces.totalCount.toString(),
          codespace.name,
          codespace.state,
          machineName,
          //machineDisplayName,
          cpuSize,
          memorySize,
          storage,
          billableOwner,
          owner,
          codespace.lastUsedAt || 'N/A',
          codespace.createdAt,
        ].join(','),
      );
    }
  }

  return rows;
}

function getCSVHeaders(): string {
  return [
    'Repository Name',
    //'Total Codespaces',
    'Codespace Name',
    'State',
    'Machine Name',
    //'Machine Display Name',
    'CPU Size',
    'Memory Size (GB)',
    'Storage (GB)',
    'Billable Owner',
    'Owner',
    'Last Used At',
    'Created At',
  ].join(',');
}

const codespacesUsageCommand = createBaseCommand({
  name: 'codespaces-usage',
  description:
    'Get codespaces usage for one or more organizations (comma-separated)',
})
  .option(
    '--organization <organization>',
    'The organization(s) to get codespaces from (comma-separated for multiple)',
    'myorg',
  )
  .option(
    '--csv-output <csvOutput>',
    'Path to write CSV output file',
    './codespaces-usage.csv',
  )
  .option(
    '--summary-output <summaryOutput>',
    'Path to write summary output file',
    './codespaces-summary.txt',
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting codespaces usage collection...');

      // Parse comma-separated organization names
      const organizations = opts.orgName
        .split(',')
        .map((org: string) => org.trim());
      logger.info(
        `Processing ${organizations.length} organization(s): ${organizations.join(', ')}`,
      );

      // Create CSV output filename template
      const baseCsvOutput = path.resolve(options.csvOutput);
      const csvDir = path.dirname(baseCsvOutput);
      const csvExt = path.extname(baseCsvOutput);
      const csvBaseName = path.basename(baseCsvOutput, csvExt);

      let totalRepositoryCount = 0;
      let totalCodespacesCount = 0;
      let totalRepositoriesWithCodespaces = 0;

      for (const organization of organizations) {
        logger.info(`\n=== Processing organization: ${organization} ===`);

        // Create org-specific CSV filename
        const orgCsvOutput = path.join(
          csvDir,
          `${csvBaseName}_${organization}${csvExt}`,
        );

        logger.info(`Fetching codespaces for organization: ${organization}`);

        fs.writeFileSync(orgCsvOutput, getCSVHeaders() + '\n');
        logger.info(`Created CSV file with headers at ${orgCsvOutput}`);

        let repositoryCount = 0;
        let totalCodespaces = 0;
        let repositoriesWithCodespaces = 0;

        for await (const repo of getCodespaceUsage(
          octokit,
          organization,
          logger,
          opts.pageSize,
        )) {
          const csvRows = repositoryToCSVRow(repo);

          for (const row of csvRows) {
            fs.appendFileSync(orgCsvOutput, row + '\n');
          }

          totalCodespaces += repo.codespaces.totalCount;
          if (repo.codespaces.totalCount > 0) {
            repositoriesWithCodespaces++;
          }

          repositoryCount++;
          if (repositoryCount % 100 === 0) {
            logger.info(
              `Processed ${repositoryCount} repositories so far for ${organization}`,
            );
          }
        }

        logger.info(`Organization ${organization} summary:`);
        logger.info(`  Repositories processed: ${repositoryCount}`);
        logger.info(
          `  Repositories with codespaces: ${repositoriesWithCodespaces}`,
        );
        logger.info(`  Total codespaces found: ${totalCodespaces}`);

        if (repositoryCount === 0) {
          logger.info(`  No repositories found for ${organization}`);
        } else {
          logger.info(`  CSV data written to ${orgCsvOutput}`);
        }

        // Add to totals
        totalRepositoryCount += repositoryCount;
        totalCodespacesCount += totalCodespaces;
        totalRepositoriesWithCodespaces += repositoriesWithCodespaces;
      }

      logger.info('\n=== Overall Summary ===');
      logger.info(`Total organizations processed: ${organizations.length}`);
      logger.info(`Total repositories processed: ${totalRepositoryCount}`);
      logger.info(
        `Total repositories with codespaces: ${totalRepositoriesWithCodespaces}`,
      );
      logger.info(`Total codespaces found: ${totalCodespacesCount}`);
      logger.info('Finished');
    });
  });

export default codespacesUsageCommand;
