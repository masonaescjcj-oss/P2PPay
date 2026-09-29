'use strict';

const config = require('./config');
const { createApp } = require('./app');

async function main() {
  const app = await createApp(config);
  const server = app.listen(config.port, () => {
    console.log(`P2PPay listening on http://localhost:${config.port}`);
    if (!config.adminUsername) console.log('Tip: set ADMIN_USERNAME / ADMIN_PASSWORD to create an admin account.');
  });
  // Graceful shutdown (rolling deploys): stop accepting, finish requests, release the DB and chain lock.
  let closing = false;
  const shutdown = (sig) => {
    if (closing) return;
    closing = true;
    console.log(`${sig}: shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await app.locals.close().catch((e) => console.error(e));
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
