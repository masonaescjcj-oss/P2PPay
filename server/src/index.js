'use strict';

const config = require('./config');
const { createApp } = require('./app');

const app = createApp(config);
app.listen(config.port, () => {
  console.log(`P2PPay listening on http://localhost:${config.port}`);
  if (!config.adminUsername) console.log('Tip: set ADMIN_USERNAME / ADMIN_PASSWORD to create an admin account.');
});
