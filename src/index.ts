import { createProgram } from '@scottluskcis/octokit-harness';

import getRepoReleaseSizesCommand from './commands/get-repo-release-sizes.js';
import getPackageDetailsCommand from './commands/get-package-details.js';
import getAssigneeIssues from './commands/get-issues-by-user.js';

const program = createProgram({
  name: 'octokit-sandbox',
  description: 'A tool for interacting with GitHub repositories',
  commands: [
    getPackageDetailsCommand,
    getRepoReleaseSizesCommand,
    getAssigneeIssues,
  ],
});

program.parse(process.argv);
