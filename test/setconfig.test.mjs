import { expect } from 'chai';

/**
 * Setconfig Command Tests
 * Tests config validation logic for the setconfig command
 */

describe('Setconfig Command', function() {
  
  // Config definitions from index.js
  const allowedConfigs = {
    gongLimit: { type: 'number', min: 1, max: 20 },
    voteLimit: { type: 'number', min: 1, max: 20 },
    voteImmuneLimit: { type: 'number', min: 1, max: 20 },
    flushVoteLimit: { type: 'number', min: 1, max: 20 },
    maxVolume: { type: 'number', min: 0, max: 100 },
    searchLimit: { type: 'number', min: 1, max: 50 },
    voteTimeLimitMinutes: { type: 'number', min: 1, max: 60 },
    themePercentage: { type: 'number', min: 0, max: 100 },
    crossfadeDurationSeconds: { type: 'number', min: 0, max: 30 },
    aiModel: { type: 'string', minLen: 1, maxLen: 50, allowed: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
    aiPrompt: { type: 'string', minLen: 1, maxLen: 500 },
    defaultTheme: { type: 'string', minLen: 0, maxLen: 100 },
    telemetryEnabled: { type: 'boolean' },
    soundcraftEnabled: { type: 'boolean' },
    soundcraftIp: { type: 'string', minLen: 0, maxLen: 50 },
    crossfadeEnabled: { type: 'boolean' },
    slackAlwaysThread: { type: 'boolean' },
    logLevel: { type: 'string', minLen: 4, maxLen: 5, allowed: ['error', 'warn', 'info', 'debug'] }
  };

  // Validation functions from index.js
  function normalizeKey(key) {
    return Object.keys(allowedConfigs).find(k => k.toLowerCase() === key.toLowerCase());
  }

  function validateNumber(value, configDef) {
    const numValue = Number(value);
    if (isNaN(numValue)) {
      return { valid: false, error: 'not_a_number' };
    }
    if (numValue < configDef.min || numValue > configDef.max) {
      return { valid: false, error: 'out_of_range', min: configDef.min, max: configDef.max };
    }
    return { valid: true, value: numValue };
  }

  function validateString(value, configDef) {
    if (value.length < (configDef.minLen || 0) || value.length > (configDef.maxLen || 500)) {
      return { valid: false, error: 'invalid_length', minLen: configDef.minLen, maxLen: configDef.maxLen };
    }
    if (configDef.allowed) {
      const matchedValue = configDef.allowed.find(a => a.toLowerCase() === value.toLowerCase());
      if (!matchedValue) {
        return { valid: false, error: 'not_allowed', allowed: configDef.allowed };
      }
      return { valid: true, value: matchedValue };
    }
    return { valid: true, value };
  }

  function validateBoolean(value) {
    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes' || lowerValue === 'on') {
      return { valid: true, value: true };
    }
    if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === 'off') {
      return { valid: true, value: false };
    }
    return { valid: false, error: 'invalid_boolean' };
  }

  describe('Key Normalization', function() {
    it('should normalize lowercase key', function() {
      expect(normalizeKey('gonglimit')).to.equal('gongLimit');
    });

    it('should normalize uppercase key', function() {
      expect(normalizeKey('GONGLIMIT')).to.equal('gongLimit');
    });

    it('should accept exact case key', function() {
      expect(normalizeKey('gongLimit')).to.equal('gongLimit');
    });

    it('should return undefined for unknown key', function() {
      expect(normalizeKey('unknownKey')).to.be.undefined;
    });

    it('should normalize logLevel variations', function() {
      expect(normalizeKey('loglevel')).to.equal('logLevel');
      expect(normalizeKey('LOGLEVEL')).to.equal('logLevel');
      expect(normalizeKey('LogLevel')).to.equal('logLevel');
    });
  });

  describe('Number Validation', function() {
    const gongLimitDef = allowedConfigs.gongLimit;
    const volumeDef = allowedConfigs.maxVolume;

    it('should accept valid number', function() {
      const result = validateNumber('5', gongLimitDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(5);
    });

    it('should accept minimum value', function() {
      const result = validateNumber('1', gongLimitDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(1);
    });

    it('should accept maximum value', function() {
      const result = validateNumber('20', gongLimitDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(20);
    });

    it('should reject value below minimum', function() {
      const result = validateNumber('0', gongLimitDef);
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('out_of_range');
    });

    it('should reject value above maximum', function() {
      const result = validateNumber('21', gongLimitDef);
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('out_of_range');
    });

    it('should reject non-numeric value', function() {
      const result = validateNumber('abc', gongLimitDef);
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('not_a_number');
    });

    it('should reject NaN', function() {
      const result = validateNumber('NaN', gongLimitDef);
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('not_a_number');
    });

    it('should accept zero for maxVolume', function() {
      const result = validateNumber('0', volumeDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(0);
    });

    it('should accept 100 for maxVolume', function() {
      const result = validateNumber('100', volumeDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(100);
    });

    it('should reject 101 for maxVolume', function() {
      const result = validateNumber('101', volumeDef);
      expect(result.valid).to.be.false;
    });

    it('should handle decimal values by converting to number', function() {
      const result = validateNumber('5.5', gongLimitDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(5.5);
    });
  });

  describe('String Validation', function() {
    const aiModelDef = allowedConfigs.aiModel;
    const aiPromptDef = allowedConfigs.aiPrompt;
    const logLevelDef = allowedConfigs.logLevel;

    it('should accept allowed aiModel value', function() {
      const result = validateString('gpt-4o', aiModelDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal('gpt-4o');
    });

    it('should accept allowed value case-insensitively', function() {
      const result = validateString('GPT-4O', aiModelDef);
      expect(result.valid).to.be.true;
      expect(result.value).to.equal('gpt-4o'); // Returns original case from allowed list
    });

    it('should reject non-allowed aiModel value', function() {
      const result = validateString('invalid-model', aiModelDef);
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('not_allowed');
    });

    it('should accept valid aiPrompt length', function() {
      const result = validateString('This is a test prompt', aiPromptDef);
      expect(result.valid).to.be.true;
    });

    it('should reject empty aiPrompt', function() {
      const result = validateString('', aiPromptDef);
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('invalid_length');
    });

    it('should reject aiPrompt exceeding max length', function() {
      const longPrompt = 'x'.repeat(501);
      const result = validateString(longPrompt, aiPromptDef);
      expect(result.valid).to.be.false;
      expect(result.error).to.equal('invalid_length');
    });

    describe('logLevel Validation', function() {
      it('should accept "debug"', function() {
        const result = validateString('debug', logLevelDef);
        expect(result.valid).to.be.true;
        expect(result.value).to.equal('debug');
      });

      it('should accept "info"', function() {
        const result = validateString('info', logLevelDef);
        expect(result.valid).to.be.true;
        expect(result.value).to.equal('info');
      });

      it('should accept "warn"', function() {
        const result = validateString('warn', logLevelDef);
        expect(result.valid).to.be.true;
        expect(result.value).to.equal('warn');
      });

      it('should accept "error"', function() {
        const result = validateString('error', logLevelDef);
        expect(result.valid).to.be.true;
        expect(result.value).to.equal('error');
      });

      it('should accept logLevel case-insensitively', function() {
        expect(validateString('DEBUG', logLevelDef).valid).to.be.true;
        expect(validateString('Info', logLevelDef).valid).to.be.true;
        expect(validateString('WARN', logLevelDef).valid).to.be.true;
      });

      it('should reject invalid logLevel', function() {
        expect(validateString('verbose', logLevelDef).valid).to.be.false;
        expect(validateString('trace', logLevelDef).valid).to.be.false;
        expect(validateString('log', logLevelDef).valid).to.be.false;
      });
    });
  });

  describe('Boolean Validation', function() {
    it('should accept "true"', function() {
      const result = validateBoolean('true');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(true);
    });

    it('should accept "false"', function() {
      const result = validateBoolean('false');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(false);
    });

    it('should accept "1" as true', function() {
      const result = validateBoolean('1');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(true);
    });

    it('should accept "0" as false', function() {
      const result = validateBoolean('0');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(false);
    });

    it('should accept "yes" as true', function() {
      const result = validateBoolean('yes');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(true);
    });

    it('should accept "no" as false', function() {
      const result = validateBoolean('no');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(false);
    });

    it('should accept "on" as true', function() {
      const result = validateBoolean('on');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(true);
    });

    it('should accept "off" as false', function() {
      const result = validateBoolean('off');
      expect(result.valid).to.be.true;
      expect(result.value).to.equal(false);
    });

    it('should be case-insensitive', function() {
      expect(validateBoolean('TRUE').value).to.equal(true);
      expect(validateBoolean('FALSE').value).to.equal(false);
      expect(validateBoolean('Yes').value).to.equal(true);
      expect(validateBoolean('No').value).to.equal(false);
    });

    it('should reject invalid boolean values', function() {
      expect(validateBoolean('maybe').valid).to.be.false;
      expect(validateBoolean('enabled').valid).to.be.false;
      expect(validateBoolean('2').valid).to.be.false;
    });
  });

  describe('Config Types', function() {
    it('should have correct types for all number configs', function() {
      const numberConfigs = ['gongLimit', 'voteLimit', 'voteImmuneLimit', 'flushVoteLimit', 
                           'maxVolume', 'searchLimit', 'voteTimeLimitMinutes', 
                           'themePercentage', 'crossfadeDurationSeconds'];
      
      for (const key of numberConfigs) {
        expect(allowedConfigs[key].type).to.equal('number');
        expect(allowedConfigs[key].min).to.be.a('number');
        expect(allowedConfigs[key].max).to.be.a('number');
      }
    });

    it('should have correct types for all boolean configs', function() {
      const booleanConfigs = ['telemetryEnabled', 'soundcraftEnabled', 
                             'crossfadeEnabled', 'slackAlwaysThread'];
      
      for (const key of booleanConfigs) {
        expect(allowedConfigs[key].type).to.equal('boolean');
      }
    });

    it('should have correct types for all string configs', function() {
      const stringConfigs = ['aiModel', 'aiPrompt', 'defaultTheme', 
                            'soundcraftIp', 'logLevel'];
      
      for (const key of stringConfigs) {
        expect(allowedConfigs[key].type).to.equal('string');
      }
    });
  });

  describe('Config Bounds', function() {
    it('should have reasonable gongLimit bounds', function() {
      const def = allowedConfigs.gongLimit;
      expect(def.min).to.be.at.least(1);
      expect(def.max).to.be.at.most(100);
    });

    it('should have reasonable maxVolume bounds', function() {
      const def = allowedConfigs.maxVolume;
      expect(def.min).to.equal(0);
      expect(def.max).to.equal(100);
    });

    it('should have reasonable searchLimit bounds', function() {
      const def = allowedConfigs.searchLimit;
      expect(def.min).to.be.at.least(1);
      expect(def.max).to.be.at.most(100);
    });

    it('should have reasonable voteTimeLimitMinutes bounds', function() {
      const def = allowedConfigs.voteTimeLimitMinutes;
      expect(def.min).to.be.at.least(1);
      expect(def.max).to.be.at.most(120);
    });
  });

  describe('Allowed Values', function() {
    it('should have valid aiModel options', function() {
      const allowed = allowedConfigs.aiModel.allowed;
      expect(allowed).to.be.an('array');
      expect(allowed.length).to.be.greaterThan(0);
      expect(allowed).to.include('gpt-4o');
    });

    it('should have valid logLevel options', function() {
      const allowed = allowedConfigs.logLevel.allowed;
      expect(allowed).to.be.an('array');
      expect(allowed).to.include('error');
      expect(allowed).to.include('warn');
      expect(allowed).to.include('info');
      expect(allowed).to.include('debug');
      expect(allowed).to.have.length(4);
    });
  });
});
