import { createProgram } from '@scottluskcis/octokit-harness';

import getRepoReleaseSizesCommand from './commands/get-repo-release-sizes.js';
import getPackageDetailsCommand from './commands/get-package-details.js';
import getAssigneeIssues from './commands/get-issues-by-user.js';
import listOrgMigrationsCommand from './commands/list-org-migrations.js';
import unlockOrgRepositoryCommand from './commands/unlock-org-repository.js';

const program = createProgram({
  name: 'octokit-sandbox',
  description: 'A tool for interacting with GitHub repositories',
  commands: [
    getPackageDetailsCommand,
    getRepoReleaseSizesCommand,
    getAssigneeIssues,
    listOrgMigrationsCommand,
    unlockOrgRepositoryCommand,
  ],
});

program.parse(process.argv);
