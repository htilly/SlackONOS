const winston = require('winston');

class WinstonWrapper {
  constructor(config) {
    this.logger = winston.createLogger(config);
    this.level = config.level || 'info';
  }

  // Add the getLevel method that Slack SDK expects
  getLevel() {
    return this.level;
  }

  // Proxy all Winston logger methods
  error(...args) {
    this.logger.error(...args);
  }

  warn(...args) {
    this.logger.warn(...args);
  }

  info(...args) {
    this.logger.info(...args);
  }

  debug(...args) {
    this.logger.debug(...args);
  }

  // Add any other Winston methods you need to proxy
}

module.exports = WinstonWrapper; 