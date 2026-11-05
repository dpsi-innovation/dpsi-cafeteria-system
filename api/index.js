const { requestHandler } = require('../src/server');

module.exports = async (req, res) => {
  return requestHandler(req, res);
};
