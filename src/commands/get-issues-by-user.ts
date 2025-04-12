import {
  createBaseCommand,
  executeWithOctokit,
} from '@scottluskcis/octokit-harness';
import { readRepositoryNames } from '../utils.js';
import fs from 'fs';
import path from 'path';

const getAssigneeIssues = createBaseCommand({
  name: 'get-issues-by-user',
  description:
    'Get issues assigned to a specific user in specified repositories',
})
  .option(
    '--assignee <login>',
    'GitHub login of the assignee to filter issues by',
    'scottluskcis',
  )
  .option(
    '--state <state>',
    'State of the issues to filter by (open, closed, all)',
    'closed',
  )
  .action(async (options) => {
    await executeWithOctokit(options, async ({ octokit, logger, opts }) => {
      logger.info('Starting...');

      const issues = [];
      const repoNames = readRepositoryNames(options.repoList, logger);
      if (repoNames.length === 0) {
        logger.error('No repositories to process, exiting');
        return;
      }

      for (const repoName of repoNames) {
        const issuesIterator = octokit.paginate.iterator(
          octokit.rest.issues.listForRepo,
          {
            owner: opts.orgName,
            repo: repoName,
            state: options.state,
            assignee: options.assignee,
            per_page: 100,
          },
        );

        for await (const { data: repoIssues } of issuesIterator) {
          for (const issue of repoIssues) {
            issues.push(issue);
            logger.info(`Issue #${issue.number}: ${issue.title}`);
            logger.debug(JSON.stringify(issue, null, 2));
          }
          logger.info(`Found ${repoIssues.length} issues in ${repoName}`);
        }
      }

      // Write issues to a JSON file
      if (issues.length > 0) {
        // Sort issues by closed_at date in ascending order
        issues.sort((a, b) => {
          const dateA = a.closed_at ? new Date(a.closed_at).getTime() : 0;
          const dateB = b.closed_at ? new Date(b.closed_at).getTime() : 0;
          return dateA - dateB;
        });

        const timestamp = new Date().toISOString().replace(/:/g, '-');
        //const fileName = `issues_${options.assignee}_${opts.orgName}_${options.state}_${timestamp}.json`;
        //const filePath = path.join(process.cwd(), fileName);

        // try {
        //   fs.writeFileSync(filePath, JSON.stringify(issues, null, 2));
        //   logger.info(
        //     `Successfully wrote ${issues.length} issues to ${fileName}`,
        //   );
        // } catch (error) {
        //   logger.error(`Failed to write issues to file: ${error}`);
        // }

        // Write issues to a markdown file with table
        const mdFileName = `issues_${options.assignee}_${opts.orgName}_${options.state}_${timestamp}.md`;
        const mdFilePath = path.join(process.cwd(), mdFileName);

        try {
          // Create markdown content
          let mdContent = `# Issues Report\n\n`;
          mdContent += `**Organization:** ${opts.orgName}  \n`;
          mdContent += `**Assignee:** ${options.assignee}  \n`;
          mdContent += `**State:** ${options.state}  \n\n`;

          // Create table header
          mdContent += `| Issue # | Title | Created By | State | Assigned To | Closed At | Closed By | Repo Name |\n`;
          mdContent += `| ------- | ----- | ---------- | ----- | ----------- | --------- | --------- | --------- |\n`;

          // Create table rows
          issues.forEach((issue) => {
            const repoUrl = issue.repository_url || '';
            const repoName = repoUrl.split('/').pop() || '';

            // Extract data with null checks
            const issueNumber = issue.number || '';
            const issueUrl = issue.html_url || '';
            const title = (issue.title || '').replace(/\|/g, '\\|'); // Escape pipe characters in markdown tables
            const createdBy = issue.user?.login || '';
            const state = issue.state || '';
            const assignedTo = issue.assignee?.login || '';
            const closedAt = issue.closed_at
              ? new Date(issue.closed_at).toLocaleDateString()
              : '';
            const closedBy = issue.closed_by?.login || '';

            mdContent += `| [${issueNumber}](${issueUrl}) | ${title} | ${createdBy} | ${state} | ${assignedTo} | ${closedAt} | ${closedBy} | ${repoName} |\n`;
          });

          // Write markdown file
          fs.writeFileSync(mdFilePath, mdContent);
          logger.info(
            `Successfully wrote ${issues.length} issues to markdown file ${mdFileName}`,
          );
        } catch (error) {
          logger.error(`Failed to write issues to markdown file: ${error}`);
        }
      } else {
        logger.info('No issues found to write to file');
      }

      logger.info('Finished');
    });
  });

export default getAssigneeIssues;
