import {
  executeWithOctokit,
  getOptsFromEnv,
} from '@scottluskcis/octokit-harness';

console.log('Hello, world!');

const opts = getOptsFromEnv();

executeWithOctokit(opts, async ({ octokit, logger }) => {
  logger.info('You got a logger!');

  if (octokit) logger.info('You got an octokit client!');

  //   const { data: user } = await octokit.rest.users.getByUsername({
  //     username: 'scottlusk',
  //   });
  //   console.log(user);
});
