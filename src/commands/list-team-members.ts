import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import * as fs from 'fs';
import * as path from 'path';
import { getTeamMembers, parseTeamNames } from '../utils/teams.js';

interface TeamMemberData {
  teamName: string;
  teamSlug: string;
  memberLogin: string;
}

const listTeamMembersCommand = createBaseCommand({
  name: 'list-team-members',
  description:
    'List team members for specified teams in a GitHub organization and output to CSV',
})
  .option(
    '--csv-output <csvOutput>',
    'Path to write CSV output file',
    './team-members.csv',
  )
  .option(
    '--teams <teams>',
    'Comma-separated list of team names/slugs to retrieve members for',
    '',
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting team members collection...');

      if (!options.teams) {
        logger.error('Teams option is required. Use --teams to specify team names/slugs');
        return;
      }

      // Parse comma-separated team names
      const teams = parseTeamNames(options.teams);

      if (teams.length === 0) {
        logger.error('No valid team names provided');
        return;
      }

      logger.info(
        `Processing ${teams.length} team(s): ${teams.join(', ')}`,
      );

      const teamMemberData: TeamMemberData[] = [];
      const teamMap = new Map<string, string[]>();

      for (const teamInput of teams) {
        try {
          // Use team input as both name and slug (teams can be referenced by either)
          const teamSlug = teamInput;
          const teamName = teamInput;

          logger.info(`Processing team: ${teamName}`);

          const members = await getTeamMembers(
            octokit,
            opts.orgName,
            teamSlug,
            teamName,
            teamMap,
            logger,
          );

          logger.info(`Found ${members.length} members in team: ${teamName}`);

          // Add each member to the data array
          for (const memberLogin of members) {
            teamMemberData.push({
              teamName,
              teamSlug,
              memberLogin,
            });
          }
        } catch (error: any) {
          logger.warn(
            `Error fetching members for team ${teamInput}: ${error.message}`,
          );
          // Continue processing other teams
        }
      }

      // Write results to CSV
      if (teamMemberData.length > 0) {
        const csvFilename = options.csvOutput
          ? path.resolve(process.cwd(), options.csvOutput)
          : path.join(
              process.cwd(),
              `team-members-${opts.orgName}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
            );

        // Write CSV header
        const csvHeaders = [
          'Organization',
          'Team Name',
          'Team Slug', 
          'Member Login',
        ];

        fs.writeFileSync(csvFilename, csvHeaders.join(',') + '\n');

        // Write team member data
        for (const data of teamMemberData) {
          const csvRow = [
            opts.orgName,
            data.teamName,
            data.teamSlug,
            data.memberLogin,
          ];
          fs.appendFileSync(csvFilename, csvRow.join(',') + '\n');
        }

        logger.info(`Team members data written to: ${csvFilename}`);
        logger.info(`Total team members found: ${teamMemberData.length}`);
      } else {
        logger.warn('No team members found');
      }

      logger.info('Finished');
    });
  });

export default listTeamMembersCommand;