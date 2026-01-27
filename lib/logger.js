const winston = require('winston');

class WinstonWrapper {
  constructor(options = {}) {
    this.logger = winston.createLogger(options);
    this.currentLevel = options.level || 'info';
  }

  debug(msg) { this.logger.debug(msg); }
  info(msg)  { this.logger.info(msg); }
  warn(msg)  { this.logger.warn(msg); }
  error(msg) { this.logger.error(msg); }

  // Slack SocketModeClient requires these:
  getLevel() {
    return this.currentLevel;
  }

  setLevel(level) {
    this.currentLevel = level;
    this.logger.level = level;
  }
}

module.exports = WinstonWrapper;

