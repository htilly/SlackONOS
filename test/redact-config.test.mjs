import { expect } from 'chai';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isSensitiveConfigKey, redactConfigValue } = require('../lib/redact-config.js');

// Regression coverage for security-review finding O-006: index.js's `debug`
// command redacted only an 8-entry exact-name allowlist that missed
// discordToken, githubToken, githubAppPrivateKey (a full RSA PEM) and
// setupBootstrapToken, while `configdump`'s separate substring heuristic
// also missed githubAppPrivateKey. Both now share this one deny-by-default
// helper.
describe('redact-config', function() {
  describe('#isSensitiveConfigKey', function() {
    // The exact keys O-006 called out as leaking via `debug` despite being
    // legitimate, routinely-populated config keys.
    const previouslyLeaked = [
      'discordToken',
      'githubToken',
      'githubAppPrivateKey',
      'setupBootstrapToken'
    ];

    for (const key of previouslyLeaked) {
      it(`flags "${key}" (previously leaked via _debug's 8-entry allowlist)`, function() {
        expect(isSensitiveConfigKey(key)).to.be.true;
      });
    }

    it('flags githubAppPrivateKey even though configdump\'s old heuristic missed it', function() {
      // "githubAppPrivateKey" contains neither "token" nor "apikey" as a
      // contiguous substring - the exact gap that let it slip past
      // configdump's /token|secret|apikey|clientid|password/i heuristic.
      expect('githubapprivatekey').to.not.include('token');
      expect('githubapprivatekey').to.not.include('apikey');
      expect(isSensitiveConfigKey('githubAppPrivateKey')).to.be.true;
    });

    it('flags every key from the original exact-name allowlist', function() {
      const original = [
        'token', 'slackAppToken', 'slackBotToken',
        'spotifyClientId', 'spotifyClientSecret',
        'openaiApiKey', 'telemetryInstanceId', 'adminPasswordHash'
      ];
      for (const key of original) {
        expect(isSensitiveConfigKey(key), key).to.be.true;
      }
    });

    it('does not flag ordinary, safe-to-display config keys', function() {
      const safeKeys = [
        'adminChannel', 'standardChannel', 'gongLimit', 'voteLimit',
        'webPort', 'httpsPort', 'sslAutoGenerate', 'defaultTheme',
        'discordChannels', 'discordAdminRoles', 'logLevel', 'aiModel',
        'ipAddress', 'market', 'maxVolume', 'blacklist', 'trustProxy'
      ];
      for (const key of safeKeys) {
        expect(isSensitiveConfigKey(key), key).to.be.false;
      }
    });

    it('is type-safe against non-string input', function() {
      expect(isSensitiveConfigKey(undefined)).to.be.false;
      expect(isSensitiveConfigKey(null)).to.be.false;
      expect(isSensitiveConfigKey(123)).to.be.false;
    });
  });

  describe('#redactConfigValue', function() {
    it('replaces a sensitive key\'s value with the redaction placeholder', function() {
      expect(redactConfigValue('githubAppPrivateKey', '"-----BEGIN RSA PRIVATE KEY-----..."')).to.equal('[REDACTED]');
    });

    it('passes through a non-sensitive key\'s value unchanged', function() {
      expect(redactConfigValue('webPort', '8080')).to.equal('8080');
    });
  });

  // Mirrors the exact write pattern of index.js's `_debug` and `configdump`
  // (both `key => redactConfigValue(key, displayValue)`) to prove no known
  // credential-shaped key from the setup wizard's allowed-keys list survives
  // unredacted. index.js itself can't be required in tests - it boots the
  // whole app - so this follows the established pattern (see
  // test/safe-object-key.test.mjs) of mirroring the exact logic instead.
  describe('guards every config key the setup wizard can write', function() {
    // Mirrors lib/setup-handler.js's SETUP_ALLOWED_KEYS.
    const SETUP_ALLOWED_KEYS = [
      'adminChannel', 'standardChannel', 'gongLimit', 'voteImmuneLimit', 'voteLimit',
      'voteTimeLimitMinutes', 'flushVoteLimit', 'sonos', 'legacySlackToken', 'slackAppToken',
      'token', 'discordToken', 'discordChannels', 'discordAdminRoles', 'openaiApiKey',
      'ttsEnabled', 'ttsProvider', 'ttsFallbackProvider', 'openaiTtsModel', 'openaiTtsVoice',
      'openaiTtsSpeed', 'openaiTtsInstructions', 'webPort', 'httpsPort', 'sslAutoGenerate',
      'sslCertPath', 'sslKeyPath', 'setupBootstrapToken', 'aiPrompt', 'aiModel',
      'aiMoodMirrorEnabled', 'defaultTheme', 'themePercentage', 'ipAddress', 'market',
      'maxVolume', 'blacklist', 'spotifyClientId', 'spotifyClientSecret', 'logLevel',
      'queueThreadThreshold', 'useLegacyBot', 'soundcraftEnabled', 'soundcraftIp',
      'soundcraftChannels', 'crossfadeEnabled', 'slackAlwaysThread', 'trustProxy',
      'webauthnEnabled', 'webauthnRpName', 'webauthnRpId', 'webauthnOrigin',
      'webauthnRequireUserVerification', 'webauthnPreferPlatformOnly', 'webauthnTimeout',
      'webauthnResidentKey', 'webauthnChallengeExpiration', 'webauthnMaxCredentials',
      'githubToken'
    ];

    // Keys among the above that genuinely hold a credential and must never
    // survive redaction.
    const KNOWN_CREDENTIAL_KEYS = new Set([
      'legacySlackToken', 'slackAppToken', 'token', 'discordToken', 'openaiApiKey',
      'setupBootstrapToken', 'spotifyClientId', 'spotifyClientSecret', 'githubToken'
    ]);

    for (const key of SETUP_ALLOWED_KEYS) {
      if (KNOWN_CREDENTIAL_KEYS.has(key)) {
        it(`redacts credential key "${key}"`, function() {
          expect(redactConfigValue(key, 'super-secret-value')).to.equal('[REDACTED]');
        });
      }
    }
  });
});
