import { Octokit } from 'octokit';

/**
 * Get team members with caching
 * @param octokit Octokit instance
 * @param orgName Organization name
 * @param teamSlug Team slug (URL-safe name)
 * @param teamName Team display name
 * @param teamMap Cache map for team members
 * @param logger Logger instance
 * @returns Array of member login names
 */
export async function getTeamMembers(
  octokit: Octokit,
  orgName: string,
  teamSlug: string,
  teamName: string,
  teamMap: Map<string, string[]>,
  logger: any,
): Promise<string[]> {
  if (teamMap.has(teamSlug)) {
    return teamMap.get(teamSlug)!;
  }

  logger.info(`Fetching members for team: ${teamName}`);
  const membersResponse = await octokit.paginate(
    octokit.rest.teams.listMembersInOrg,
    {
      org: orgName,
      team_slug: teamSlug,
      per_page: 100,
    },
  );
  const members = membersResponse.map((m: any) => m.login);
  teamMap.set(teamSlug, members);
  return members;
}

/**
 * Parse comma-separated team names and trim them
 * @param teamsInput Comma-separated string of team names
 * @returns Array of trimmed team names
 */
export function parseTeamNames(teamsInput: string): string[] {
  return teamsInput
    .split(',')
    .map((team: string) => team.trim())
    .filter((team: string) => team.length > 0);
}
