const { createApp } = require('./app');
const { loadConfig } = require('./config');

const config = loadConfig();
createApp(config).listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
