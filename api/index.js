let requestHandler;
try {
  const serverModule = require('../src/server');
  requestHandler = serverModule.requestHandler;
} catch (err) {
  console.error('[SERVER_INIT_ERROR]', err);
}

module.exports = async (req, res) => {
  try {
    if (!requestHandler) {
      const serverModule = require('../src/server');
      requestHandler = serverModule.requestHandler;
    }
    return await requestHandler(req, res);
  } catch (err) {
    console.error('[API_FATAL_ERROR]', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'API Execution Error',
        message: err.message,
        timestamp: new Date().toISOString()
      }));
    }
  }
};
