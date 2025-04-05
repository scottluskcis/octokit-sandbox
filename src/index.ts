import { createProgram } from '@scottluskcis/octokit-harness';

import findPackagesCommand from './commands/find-packages.js';
import getRepoReleaseSizesCommand from './commands/get-repo-release-sizes.js';

const program = createProgram({
  name: 'octokit-sandbox',
  description: 'A tool for interacting with GitHub repositories',
  commands: [findPackagesCommand, getRepoReleaseSizesCommand],
});

program.parse(process.argv);
