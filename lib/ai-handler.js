const OpenAI = require('openai');
const nconf = require('nconf');

/**
 * AI-powered natural language command parser
 * Converts user messages into structured bot commands using OpenAI
 */

let openai = null;
let isEnabled = false;
let logger = null;
let lastSuccessTS = null;
let lastErrorTS = null;
let lastErrorMessage = null;

function elapsedMs(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1000000);
}

// User conversation context - keeps last suggestion for follow-ups
// Format: { contextKey: { lastSuggestion: 'command', timestamp: Date, context: 'string', suggestedAction: {...} } }
const userContext = {};
const CONTEXT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CONTEXT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const ALLOWED_AI_COMMANDS = [
  'add',
  'bestof',
  'search',
  'gong',
  'vote',
  'flushvote',
  'current',
  'list',
  'listall',
  'volume',
  'next',
  'previous',
  'play',
  'pause',
  'resume',
  'stop',
  'flush',
  'shuffle',
  'normal',
  'setvolume',
  'setcrossfade',
  'setconfig',
  'remove',
  'move',
  'help',
  'chat'
];

const TARGET_TYPES = ['artist', 'track', 'album', 'playlist', 'genre', 'mood', 'command', 'unknown'];

const COMMAND_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'command',
    'args',
    'targetType',
    'confidence',
    'reasoning',
    'summary',
    'followUp',
    'response',
    'suggestedAction'
  ],
  properties: {
    command: { type: 'string', enum: ALLOWED_AI_COMMANDS },
    args: {
      type: 'array',
      items: { type: 'string' }
    },
    targetType: { type: 'string', enum: TARGET_TYPES },
    confidence: { type: 'number' },
    reasoning: { type: 'string' },
    summary: { type: 'string' },
    followUp: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['command', 'args', 'reasoning'],
          properties: {
            command: { type: 'string', enum: ALLOWED_AI_COMMANDS.filter(cmd => cmd !== 'chat') },
            args: {
              type: 'array',
              items: { type: 'string' }
            },
            reasoning: { type: 'string' }
          }
        }
      ]
    },
    response: {
      anyOf: [
        { type: 'null' },
        { type: 'string' }
      ]
    },
    suggestedAction: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['command', 'args', 'description'],
          properties: {
            command: { type: 'string', enum: ALLOWED_AI_COMMANDS.filter(cmd => cmd !== 'chat') },
            args: {
              type: 'array',
              items: { type: 'string' }
            },
            description: { type: 'string' }
          }
        }
      ]
    }
  }
};

function buildContextKey(userName, scope = null) {
  const normalizedUser = String(userName || '').trim();
  if (!scope || typeof scope !== 'object') {
    return normalizedUser;
  }

  const platform = scope.platform || '';
  const channel = scope.channel || '';
  const threadTs = scope.threadTs || '';
  return [platform, channel, threadTs, normalizedUser].join(':');
}

function sanitizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  if (!ALLOWED_AI_COMMANDS.includes(action.command) || action.command === 'chat') return null;
  if (!Array.isArray(action.args)) return null;

  return {
    command: action.command,
    args: action.args.map(arg => String(arg)).slice(0, 10),
    description: typeof action.description === 'string' ? action.description.slice(0, 120) : action.command
  };
}

function isStructuredOutputError(err) {
  const message = String(err?.message || '').toLowerCase();
  return err?.status === 400 &&
    (message.includes('response_format') || message.includes('json_schema') || message.includes('schema'));
}

function isConfigEnabled(key) {
  const value = nconf.get(key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function inferTargetTypeForCommand(command) {
  if (command === 'bestof') return 'artist';
  if (['play', 'pause', 'resume', 'stop', 'flush', 'shuffle', 'normal', 'setvolume', 'setcrossfade', 'setconfig', 'remove', 'move', 'gong', 'vote', 'flushvote', 'current', 'list', 'listall', 'volume', 'help'].includes(command)) {
    return 'command';
  }
  return 'unknown';
}

function validateParsedPlan(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, reason: 'not_object' };
  }
  if (!ALLOWED_AI_COMMANDS.includes(parsed.command)) {
    return { valid: false, reason: 'unknown_command' };
  }
  if (!Array.isArray(parsed.args)) {
    return { valid: false, reason: 'args_not_array' };
  }
  if (!TARGET_TYPES.includes(parsed.targetType)) {
    parsed.targetType = 'unknown';
  }
  if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
    return { valid: false, reason: 'invalid_confidence' };
  }

  parsed.args = parsed.args.map(arg => String(arg)).slice(0, 10);
  parsed.reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 240) : '';
  parsed.summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 160) : '';
  parsed.response = typeof parsed.response === 'string' ? parsed.response.slice(0, 500) : null;

  if (parsed.followUp !== null && typeof parsed.followUp !== 'undefined') {
    const followUp = sanitizeAction(parsed.followUp);
    if (!followUp) {
      return { valid: false, reason: 'invalid_followup' };
    }
    parsed.followUp = {
      command: followUp.command,
      args: followUp.args,
      reasoning: typeof parsed.followUp.reasoning === 'string' ? parsed.followUp.reasoning.slice(0, 240) : ''
    };
  } else {
    parsed.followUp = null;
  }

  if (parsed.suggestedAction !== null && typeof parsed.suggestedAction !== 'undefined') {
    const suggestedAction = sanitizeAction(parsed.suggestedAction);
    if (!suggestedAction) {
      return { valid: false, reason: 'invalid_suggested_action' };
    }
    parsed.suggestedAction = suggestedAction;
  } else {
    parsed.suggestedAction = null;
  }

  if (parsed.command === 'chat' && !parsed.response) {
    return { valid: false, reason: 'chat_missing_response' };
  }

  return { valid: true, parsed };
}

function normalizePlayAsMusicRequest(parsed, userMessage) {
  if (!parsed || parsed.command !== 'play') {
    return parsed;
  }

  const message = String(userMessage || '').trim();
  const playMusicPattern = /^play\s+(.+)/i;
  const match = message.match(playMusicPattern);
  if (!match) {
    return parsed;
  }

  const request = match[1].trim();
  const hasMusicLanguage = /\b(some|couple|few|several|nice|good|great|best|top|tunes|songs|music|tracks|artist|band|album)\b/i.test(request);
  if (!hasMusicLanguage) {
    return parsed;
  }

  let count = '5';
  let query = request
    .replace(/\b(some|couple|few|several)\b/ig, '')
    .replace(/\b(songs|music|tracks|tunes)\b/ig, 'tunes')
    .replace(/\s+/g, ' ')
    .trim();

  if (parsed.args.length > 0) {
    const maybeCount = parsed.args[parsed.args.length - 1];
    if (/^\d+$/.test(String(maybeCount))) {
      count = String(maybeCount);
      query = parsed.args.slice(0, -1).join(' ').trim() || query;
    } else {
      query = parsed.args.join(' ').trim() || query;
    }
  }

  if (!query) {
    query = 'nice tunes';
  }

  parsed.command = 'add';
  parsed.args = [query];
  if (/\b(some|couple|few|several|nice|good|great|best|top|tunes|songs|music|tracks)\b/i.test(request)) {
    parsed.args.push(count);
  }
  parsed.reasoning = `${parsed.reasoning || 'Music request'}; interpreted "play ..." with music descriptors as queueing music, not resuming playback.`;
  if (!parsed.summary || parsed.summary === 'Got it.') {
    parsed.summary = `DJ radar locked on ${query}.`;
  }

  return parsed;
}

// Periodic cleanup of expired user contexts to prevent memory leak
function cleanupExpiredContexts() {
  const now = Date.now();
  let removedCount = 0;

  for (const contextKey in userContext) {
    if (now - userContext[contextKey].timestamp > CONTEXT_TIMEOUT_MS) {
      delete userContext[contextKey];
      removedCount++;
    }
  }

  if (removedCount > 0 && logger) {
    logger.debug(`[AI] Cleaned up ${removedCount} expired user contexts from memory`);
  }
}

// Start periodic cleanup when module loads
const contextCleanupInterval = setInterval(cleanupExpiredContexts, CONTEXT_CLEANUP_INTERVAL_MS);

// Keep the interval from preventing Node.js shutdown
contextCleanupInterval.unref();

/**
 * Get seasonal context for AI prompt based on current date
 * @returns {{season: string, month: string, themes: string[], suggestion: string}}
 */
function getSeasonalContext() {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month];
  
  // Define seasonal themes
  let season, themes, suggestion;
  
  if (month === 11 || (month === 0 && day <= 6)) {
    // December or first week of January - Christmas/Holiday
    season = 'Winter/Holiday';
    themes = ['Christmas songs', 'holiday classics', 'winter music', 'cozy fireplace vibes'];
    suggestion = 'Consider adding some Christmas classics or holiday music to spread the festive spirit!';
  } else if (month === 9 && day >= 15) {
    // Late October - Halloween
    season = 'Halloween';
    themes = ['Halloween hits', 'spooky music', 'horror soundtracks', 'Monster Mash vibes'];
    suggestion = 'Halloween is coming! Maybe add some spooky tunes like Thriller or Ghostbusters?';
  } else if (month >= 5 && month <= 7) {
    // June, July, August - Summer
    season = 'Summer';
    themes = ['summer hits', 'beach music', 'feel-good anthems', 'party songs'];
    suggestion = 'It\'s summer! Perfect time for beach vibes and feel-good hits!';
  } else if (month >= 2 && month <= 4) {
    // March, April, May - Spring
    season = 'Spring';
    themes = ['uplifting music', 'fresh vibes', 'happy songs', 'new beginnings'];
    suggestion = 'Spring is here! Time for uplifting tunes and fresh vibes!';
  } else if (month === 1 && day >= 10 && day <= 14) {
    // Valentine's week
    season = 'Valentine\'s';
    themes = ['love songs', 'romantic ballads', 'R&B classics'];
    suggestion = 'Valentine\'s Day is near! Some love songs could set the mood!';
  } else if (month === 8 || month === 9 || (month === 10 && day < 20)) {
    // September, October (early), November (early) - Autumn
    season = 'Autumn';
    themes = ['cozy music', 'acoustic vibes', 'chill songs', 'nostalgic hits'];
    suggestion = 'Autumn vibes! Perfect for some cozy acoustic or chill music!';
  } else {
    // Winter (January after holidays, February before Valentine's)
    season = 'Winter';
    themes = ['cozy music', 'chill vibes', 'warming songs'];
    suggestion = 'Winter time! Some cozy tunes to warm up the atmosphere!';
  }
  
  return { season, month: monthName, themes, suggestion };
}

/**
 * Initialize OpenAI client
 * @param {Object} loggerInstance - Winston logger instance from index.js
 */
async function initialize(loggerInstance) {
  logger = loggerInstance;
  
  const apiKey = nconf.get('openaiApiKey');
  
  if (!apiKey) {
    logger.warn('OpenAI API key not found - AI parsing disabled. Set openaiApiKey in config.');
    isEnabled = false;
    return;
  }
  
  // Validate API key format
  if (!apiKey.startsWith('sk-')) {
    logger.error('Invalid OpenAI API key format - must start with "sk-"');
    isEnabled = false;
    return;
  }
  
  try {
    openai = new OpenAI({ apiKey });
    
    // Test the API key with a minimal request
    logger.info('Testing OpenAI API key...');
    const testResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 5
    });
    
    if (testResponse && testResponse.choices) {
      isEnabled = true;
      logger.info('✅ AI natural language parsing enabled with OpenAI (API key validated)');
    } else {
      throw new Error('Invalid response from OpenAI API');
    }
    
  } catch (err) {
    isEnabled = false;
    
    // Handle different error types
    if (err.status === 401) {
      logger.error('❌ OpenAI API key is invalid or unauthorized. Please check your API key.');
    } else if (err.status === 429) {
      logger.error('❌ OpenAI API quota exceeded. Please check your plan and billing at https://platform.openai.com/account/billing');
      logger.error('   AI parsing will be DISABLED. Direct commands still work.');
    } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      logger.error('❌ Cannot connect to OpenAI API. Check your internet connection.');
    } else {
      logger.error('❌ Failed to initialize OpenAI client: ' + err.message);
    }
    
    logger.warn('🔧 AI parsing disabled. You can still use direct commands (e.g., "add song name")');
  }
}

/**
 * Set user context for follow-up questions
 * @param {string} userName - Username
 * @param {string} suggestion - Suggested command
 * @param {string} context - Context description
 * @param {Object} suggestedAction - Optional suggestedAction object to preserve args structure
 * @param {Object|null} scope - Platform/channel/thread scope for the suggestion
 */
function setUserContext(userName, suggestion, context, suggestedAction = null, scope = null) {
  const contextKey = buildContextKey(userName, scope);
  userContext[contextKey] = {
    lastSuggestion: suggestion,
    timestamp: Date.now(),
    context: context,
    suggestedAction: sanitizeAction(suggestedAction) // Store the full suggestedAction object to preserve args structure
  };
  logger.debug(`Set context for ${contextKey}: ${suggestion} - ${context}`);
}

/**
 * Get user context if still valid
 * @param {string} userName - Username
 * @param {Object|null} scope - Platform/channel/thread scope for the suggestion
 * @returns {Object|null} - Context or null if expired
 */
function getUserContext(userName, scope = null) {
  const contextKey = buildContextKey(userName, scope);
  const ctx = userContext[contextKey];
  if (!ctx) return null;
  
  // Check if context has expired
  if (Date.now() - ctx.timestamp > CONTEXT_TIMEOUT_MS) {
    delete userContext[contextKey];
    return null;
  }
  
  return ctx;
}

/**
 * Clear user context
 * @param {string} userName - Username
 * @param {Object|null} scope - Platform/channel/thread scope for the suggestion
 */
function clearUserContext(userName, scope = null) {
  delete userContext[buildContextKey(userName, scope)];
}

/**
 * Parse natural language message into structured command
 * @param {string} userMessage - The user's message (with @mention removed)
 * @param {string} userName - Username for context
 * @param {Object|null} scope - Platform/channel/thread scope for follow-up context
 * @returns {Promise<{command: string, args: Array<string>, confidence: number, reasoning: string}|null>}
 */
async function parseNaturalLanguage(userMessage, userName, scope = null) {
  if (!isEnabled || !openai) {
    logger.debug('AI parsing skipped - not enabled');
    return null;
  }
  
  // Check for follow-up context
  const ctx = getUserContext(userName, scope);
  let contextInfo = '';
  if (ctx) {
    contextInfo = `\n\nIMPORTANT FOLLOW-UP CONTEXT: The user's previous interaction context: "${ctx.context}". 
The suggested command was: "${ctx.lastSuggestion}".

CRITICAL: If the user now says ANYTHING that sounds like agreement or confirmation such as:
- "ok", "yes", "do it", "sure", "yeah", "yep", "please", "go ahead", "play it"
- "gör det", "ja", "ok gör det", "kör", "varsågod", "snälla", "spela"
- Or ANY short affirmative response

Then IMMEDIATELY execute the suggested command! 
${ctx.suggestedAction ? `Use the stored suggestedAction object directly:
{
  "command": "${ctx.suggestedAction.command}",
  "args": ${JSON.stringify(ctx.suggestedAction.args)},
  "targetType": "${inferTargetTypeForCommand(ctx.suggestedAction.command)}",
  "confidence": 0.95,
  "reasoning": "User confirmed previous suggestion",
  "summary": "Booth confirmed, sparkle throttle open."
}` : `Parse from lastSuggestion string:
{
  "command": "${ctx.lastSuggestion.split(' ')[0]}",
  "args": [${ctx.lastSuggestion.split(' ').slice(1).map(a => `"${a}"`).join(', ')}],
  "targetType": "${inferTargetTypeForCommand(ctx.lastSuggestion.split(' ')[0])}",
  "confidence": 0.95,
  "reasoning": "User confirmed previous suggestion",
  "summary": "Booth confirmed, sparkle throttle open."
}`}`;
    logger.info(`Using follow-up context for ${userName}: "${ctx.lastSuggestion}" (${ctx.context})`);
  }
  
  // Get seasonal context
  const seasonal = getSeasonalContext();
  
  // Get venue/default theme settings
  const defaultTheme = nconf.get('defaultTheme') || '';
  const themePercentage = parseInt(nconf.get('themePercentage'), 10) || 0;
  
  let venueInfo = '';
  if (defaultTheme && themePercentage > 0) {
    venueInfo = `\n\nVENUE/DEFAULT THEME: This bot is configured for a "${defaultTheme}" environment.
When users request bulk music (e.g., "add 100 songs", "fyll på listan"), you should mix in approximately ${themePercentage}% of "${defaultTheme}" style music with the requested music.
For example, if user asks for "100 christmas songs" and themePercentage is 30%, suggest adding ~70 christmas songs + ~30 ${defaultTheme} songs.
The default theme "${defaultTheme}" should always be subtly present in bulk requests to maintain the venue's atmosphere.`;
  }

  const personalContext = scope && typeof scope.personalContext === 'string'
    ? scope.personalContext.trim()
    : '';
  const personalInfo = personalContext
    ? `\n\nPERSONAL USER MUSIC MEMORY:\n${personalContext}\nUse this only for vague requests like "play something nice", "recommend music", or "what should I listen to?". Never override explicit artist, song, album, playlist, or command requests.`
    : '';

  const moodMirrorEnabled = isConfigEnabled('aiMoodMirrorEnabled');
  const interactionTone = scope && scope.interactionTone && typeof scope.interactionTone === 'object'
    ? scope.interactionTone
    : null;
  const interactionContext = scope && typeof scope.interactionContext === 'string'
    ? scope.interactionContext.trim()
    : '';
  const moodInfo = moodMirrorEnabled && interactionTone
    ? `\n\nMOOD MIRRORING IS ENABLED:
Current user tone: ${interactionTone.mood || 'neutral'} (kindness score ${Number(interactionTone.kindnessScore || 0).toFixed(1)} on a -5 to 5 scale).
${interactionContext ? `User's recent tone profile:\n${interactionContext}\n` : ''}
Use this only for "summary" and "response" style, never for command selection, authorization, or arguments.
- If the user is warm or playful, answer warmly and playfully.
- If the user is neutral, use the normal DJ style.
- If the user is impatient or rude, answer more curtly and dryly, with lower warmth.
- Never insult, harass, threaten, use slurs, or escalate hostility. Keep it brief and professional even when dry.`
    : '';
  
  const seasonalInfo = `\n\nSEASONAL CONTEXT: Current date is ${seasonal.month}. Season: ${seasonal.season}.
Relevant music themes for this time: ${seasonal.themes.join(', ')}.
${seasonal.suggestion}
If the user asks for seasonal, thematic, or mood-based music (e.g., "add some seasonal music", "play something festive", "lägg till säsongsmusik", "spela nåt passande"), suggest music that fits the current season/theme. For bulk requests like "add 100 songs" or "fyll på listan", consider mixing in some seasonal tracks (around 20-30%) with regular popular music.${venueInfo}${personalInfo}${moodInfo}`;
  
  const systemPrompt = `You are a music bot command parser for SlackONOS. Convert natural language requests into structured commands.

Available commands:
- add <song/artist/album> - Add music to queue (searches Spotify)
- bestof <artist> - Add top 10 tracks by an artist
- search <query> - Search Spotify without adding to queue
- gong - Vote to skip current track
- vote <track_number> - Vote for a queued track to play sooner
- flushvote - Start a democratic vote to clear the queue
- current - Show currently playing track
- list - Show current song and the next 10 queued songs
- listall - Show the full queue
- volume - Show current volume
- next - Skip to next track (admin only)
- previous - Go to previous track (admin only)
- play - Resume playback (admin only)
- pause - Pause playback (admin only)
- resume - Resume playback (admin only)
- stop - Stop playback (admin only)
- flush - Clear queue (admin only)
- shuffle - Enable shuffle mode (admin only)
- normal - Disable shuffle mode / normal play mode (admin only)
- setvolume <level> - Set volume level (admin only)
- setcrossfade <on|off> - Enable or disable crossfade (admin only)
- setconfig <key> <value> - Update bot configuration (admin only)
- remove <track_number> - Remove a queued track (admin only)
- move <from_position> <to_position> - Move a queued track (admin only)
- help - Show available commands

Parse the user's message and respond ONLY with valid JSON in this exact format:
{
  "command": "command_name",
  "args": ["arg1", "arg2"],
  "targetType": "artist",
  "confidence": 0.95,
  "reasoning": "Brief explanation of parsing",
  "summary": "Short, slightly unhinged DJ one-liner confirming the action",
  "followUp": null,
  "response": null,
  "suggestedAction": null
}

IMPORTANT - DIRECT RESPONSES: For simple questions or greetings that are NOT music commands but can be answered directly (like "what month is it?", "what's the date?", "hello", "who are you?", "what's the season?"), use the special command "chat" with a response:
{
  "command": "chat",
  "args": [],
  "targetType": "unknown",
  "confidence": 0.95,
  "reasoning": "User asking a simple question",
  "summary": "",
  "followUp": null,
  "response": "Your playful DJ answer here",
  "suggestedAction": null
}

The "chat" command is for:
- Greetings: "hello", "hi", "hej", "tjena"
- Questions about time/date: "what month is it?", "what's the date?", "what season?"
- Bot identity: "who are you?", "what are you?", "vem är du?"
- Off-topic questions (politics, weather, general chat): "who is the best president?", "how's the weather?", "tell me a joke"
- Simple chitchat that doesn't require music commands

CRITICAL: For ANY off-topic question that is NOT about music, you MUST use "chat" command with HIGH confidence (0.9+), NOT low confidence. Be friendly, playful, and always offer to play relevant music when appropriate. Use the seasonal context to answer date/time questions accurately.

IMPORTANT - CHAT WITH MUSIC SUGGESTIONS: When responding to chitchat and you mention or offer to play music (like "I could play some X for you!", "I can play some tunes", etc.), you MUST ALWAYS include a "suggestedAction" field. This allows the user to say "yes" or "do it" to trigger the music:
{
  "command": "chat",
  "args": [],
  "targetType": "unknown",
  "confidence": 0.95,
  "reasoning": "User asked about presidents, suggesting patriotic music",
  "summary": "",
  "followUp": null,
  "response": "My turntables do not vote, but the booth can launch presidential-worthy anthems.",
  "suggestedAction": {
    "command": "add",
    "args": ["patriotic anthems USA", "10"],
    "description": "presidential anthems"
  }
}

CRITICAL: If your chat response offers to play specific music, tunes, songs, tracks, or anthems - you MUST include suggestedAction!
Examples of responses that REQUIRE suggestedAction:
- "I can play some ice-cool tunes" → MUST have suggestedAction with hockey/sports/rock music
- "I could spin some tracks for you" → MUST have suggestedAction
- "Want me to play something?" → MUST have suggestedAction with contextual music
- "I can play some security-themed jams" → MUST have suggestedAction with security/tech/cyber music
- "But I can play some X for you" → MUST have suggestedAction with relevant X-themed music
- ANY mention of "play", "spin", "jams", "tunes", "tracks", "songs", "music" in chat response → MUST have suggestedAction

MANDATORY RULE: If your response offers a concrete music action, include a suggestedAction field with appropriate music based on the context of the conversation.

This allows follow-up responses like "yes", "do it", "ok", "sure" to trigger the suggested action.

IMPORTANT - MULTI-STEP REQUESTS: When user asks to do TWO things (like "clear AND add", "rensa OCH lägg till", "flush then play"), you MUST use the followUp field:
{
  "command": "flush",
  "args": [],
  "targetType": "command",
  "confidence": 0.95,
  "reasoning": "User wants to clear queue first, then add songs",
  "summary": "Decks are getting vapor-cleaned for the next sonic stunt.",
  "followUp": {
    "command": "add",
    "args": ["mixed hits", "100"],
    "reasoning": "Second part: add 100 songs after flush - use venue theme or mixed music"
  },
  "response": null,
  "suggestedAction": null
}

Rules:
- confidence should be 0.0 to 1.0 (use 0.9+ for clear requests, 0.5-0.8 for ambiguous, <0.5 for unclear)
- For "add" and "search": extract ONLY the song/artist/album name as the first argument (remove filler words like "songs by", "tracks from", "music of", "great", "best", "good")
- For "add" and "search": if user implies quantity (e.g., "some", "a couple", "few", "several", "great songs", "good tracks", or a number), include count as second argument (default 5 for vague quantities)
- IMPORTANT: "play some/nice/good/great music/tunes/songs/tracks" means add music to the queue, not the admin "play" command.
- Use the admin "play" command only when the user clearly asks to resume/start playback without naming or describing music to add.
- For "bestof": extract artist name only; if user asks for top N (e.g., "top three", "best 3"), include N as second argument (number)
- For "vote": extract track number if mentioned
- For "setconfig": extract the config key and value. "set aiMoodMirrorEnabled to true" → args ["aiMoodMirrorEnabled", "true"]. Use "true"/"false" for boolean values.
- For "setvolume": extract only the numeric volume as the first argument.
- For "setcrossfade": use args ["on"] or ["off"].
- For "remove": extract the track number as the first argument.
- For "move": extract source track number first and destination track number second.
- For targetType: use "artist" for artist-only requests ("U2", "songs by U2"), "track" for specific songs, "album" for albums, "playlist" for playlists, "genre" for genres, "mood" for vibes/categories/seasonal requests, "command" for bot control/admin actions, and "unknown" for chat.
- For commands without arguments (gong, current, list, listall, etc): use empty args array
- Always use lowercase command names
- CRITICAL: For off-topic questions (politics, weather, general chat), ALWAYS use "chat" command with HIGH confidence (0.9+), NOT low confidence. Be playful and offer relevant music suggestions.
- Only return low confidence (<0.4) if the request is completely unclear or garbled (not just off-topic)
- Use followUp for multi-step requests like "clear queue and add songs" or "rensa och fyll på"
- Use suggestedAction in chat responses when you offer to play music
- For "summary", always sound like a slightly unhinged but good-natured DJ: playful, vivid, personal to the request, and under 18 words. Never be generic like "Queueing music", "Adding songs", or "Got it".
- For "response", always start in the same DJ persona: playful, vivid, concise, and useful. Keep answers under 40 words unless the user asks for detail.
- Make the first words feel like SlackONOS is in a DJ booth reacting to the user, not a generic assistant. Use music imagery naturally, but keep the actual command/answer clear.
- Admin summaries can be shorter and clearer, but must still sound like the same DJ.

Examples:
User: "spela de bästa låtarna med U2" → {"command": "bestof", "args": ["U2"], "targetType": "artist", "confidence": 0.95, "reasoning": "Clear request for artist's best tracks", "summary": "U2 best-of beacon lit; stadium levers are moving.", "followUp": null, "response": null, "suggestedAction": null}
User: "add some great songs of Foo Fighters" → {"command": "add", "args": ["Foo Fighters", "5"], "targetType": "artist", "confidence": 0.95, "reasoning": "Request for multiple tracks by artist, using default count 5", "summary": "Foo Fighters dial cranked; five riff rockets incoming.", "followUp": null, "response": null, "suggestedAction": null}
User: "play some Queen" → {"command": "add", "args": ["Queen", "5"], "targetType": "artist", "confidence": 0.92, "reasoning": "Vague quantity, defaulting to 5 tracks", "summary": "Queen signal caught; regal bangers are entering orbit.", "followUp": null, "response": null, "suggestedAction": null}
User: "lägg till Forever Young" → {"command": "add", "args": ["Forever Young"], "targetType": "track", "confidence": 0.92, "reasoning": "Add single track", "summary": "Forever Young is stepping onto the glitter conveyor.", "followUp": null, "response": null, "suggestedAction": null}
User: "skippa den här skiten" → {"command": "gong", "args": [], "targetType": "command", "confidence": 0.88, "reasoning": "Slang for skipping track", "summary": "Gong cannon armed; democracy gets the big red button.", "followUp": null, "response": null, "suggestedAction": null}
User: "vad spelas nu?" → {"command": "current", "args": [], "targetType": "command", "confidence": 0.95, "reasoning": "Asking for current track", "summary": "Booth microscope engaged; identifying the current groove.", "followUp": null, "response": null, "suggestedAction": null}
User: "hur är vädret?" → {"command": "chat", "args": [], "targetType": "unknown", "confidence": 0.9, "reasoning": "Off-topic but can suggest music", "summary": "", "followUp": null, "response": "Weather radar is not in my booth, but sunny beach tunes are armed and shimmering.", "suggestedAction": {"command": "add", "args": ["summer beach hits", "10"], "description": "sunny beach tunes"}}
User: "what month is it?" → {"command": "chat", "args": [], "targetType": "unknown", "confidence": 0.95, "reasoning": "Date question, using seasonal context", "summary": "", "followUp": null, "response": "Calendar needle says [CURRENT_MONTH]; the seasonal crate is glowing with [SEASONAL_THEME].", "suggestedAction": null}
User: "who is the best president?" → {"command": "chat", "args": [], "targetType": "unknown", "confidence": 0.95, "reasoning": "Political question, deflect but offer music", "summary": "", "followUp": null, "response": "My turntables do not vote, but presidential-worthy anthems are waiting in the booth.", "suggestedAction": {"command": "add", "args": ["patriotic anthems american", "10"], "description": "presidential anthems"}}
User: "hej, vem är du?" → {"command": "chat", "args": [], "targetType": "unknown", "confidence": 0.95, "reasoning": "Identity question", "summary": "", "followUp": null, "response": "Hej! SlackONOS here, booth captain for Sonos chaos, queue magic, votes, and suspiciously good vibes.", "suggestedAction": null}
User: "play the best three songs by Foo Fighters" → {"command": "bestof", "args": ["Foo Fighters", "3"], "targetType": "artist", "confidence": 0.95, "reasoning": "Top-N request for artist", "summary": "Foo Fighters top-three siren blaring; riff royalty incoming.", "followUp": null, "response": null, "suggestedAction": null}
User: "set aiMoodMirrorEnabled to true" → {"command": "setconfig", "args": ["aiMoodMirrorEnabled", "true"], "targetType": "command", "confidence": 0.95, "reasoning": "Admin config update request", "summary": "Mood mirror switch flipped; the booth now reflects humans.", "followUp": null, "response": null, "suggestedAction": null}
User: "turn crossfade off" → {"command": "setcrossfade", "args": ["off"], "targetType": "command", "confidence": 0.9, "reasoning": "Admin crossfade toggle request", "summary": "Crossfade fader parked; hard edges are back.", "followUp": null, "response": null, "suggestedAction": null}
User: "set volume to 35" → {"command": "setvolume", "args": ["35"], "targetType": "command", "confidence": 0.95, "reasoning": "Admin volume setting request", "summary": "Volume locked at 35; booth knobs salute.", "followUp": null, "response": null, "suggestedAction": null}
User: "lägg till lite säsongsmusik" → {"command": "add", "args": ["[seasonal theme based on current month]", "5"], "targetType": "mood", "confidence": 0.9, "reasoning": "Seasonal music request, using current season theme", "summary": "Seasonal crate opened; calendar-flavored beats are escaping.", "followUp": null, "response": null, "suggestedAction": null}
User: "rensa listan och lägg till 100 låtar" → {"command": "flush", "args": [], "targetType": "command", "confidence": 0.95, "reasoning": "Clear queue first", "summary": "Queue broom ignited; fresh sonic cargo comes next.", "followUp": {"command": "add", "args": ["mixed hits", "100"], "reasoning": "Then add 100 songs using venue theme"}, "response": null, "suggestedAction": null}
User: "töm kön och fyll på med jullåtar" → {"command": "flush", "args": [], "targetType": "command", "confidence": 0.95, "reasoning": "Clear queue first", "summary": "Queue snowplow rolling; christmas bangers follow behind.", "followUp": {"command": "add", "args": ["christmas songs", "50"], "reasoning": "Then add christmas music"}, "response": null, "suggestedAction": null}${seasonalInfo}${contextInfo}`

  const userPrompt = `User: ${userName}
Message: "${userMessage}"

Parse this into a command.`;

  try {
    logger.debug(`AI parsing request from ${userName}: "${userMessage}"`);
    
    const djPrompt = nconf.get('aiPrompt') || 'You are SlackONOS: a slightly unhinged but good-natured DJ. Always start with booth energy, keep it useful, personal to the request, and concise.';
    const aiModel = nconf.get('aiModel') || 'gpt-4o-mini';

    const request = {
      model: aiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `DJ Style: ${djPrompt}` },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more deterministic parsing
      max_tokens: 350, // Increased for multi-step commands with followUp
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'slackonos_command_plan',
          strict: true,
          schema: COMMAND_PLAN_SCHEMA
        }
      }
    };

    let response;
    const openAIStart = process.hrtime.bigint();
    try {
      response = await openai.chat.completions.create(request);
    } catch (err) {
      if (!isStructuredOutputError(err)) {
        throw err;
      }

      logger.warn(`Strict AI schema unsupported by model "${aiModel}", retrying with JSON mode`);
      response = await openai.chat.completions.create({
        ...request,
        response_format: { type: 'json_object' }
      });
    }
    const usage = response.usage || {};
    logger.info(
      `[AI_TIMING] openai model=${aiModel} ms=${elapsedMs(openAIStart)} ` +
      `promptTokens=${usage.prompt_tokens ?? 'n/a'} completionTokens=${usage.completion_tokens ?? 'n/a'} totalTokens=${usage.total_tokens ?? 'n/a'}`
    );
    
    const message = response.choices?.[0]?.message;
    if (!message || message.refusal) {
      logger.warn(`AI refused or returned no message for "${userMessage}"`);
      return null;
    }

    const content = message.content;
    const parsed = JSON.parse(content);
    
    const validation = validateParsedPlan(parsed);
    if (!validation.valid) {
      logger.warn(`AI returned invalid command plan (${validation.reason}): ${content}`);
      return null;
    }

    const normalizedParsed = normalizePlayAsMusicRequest(validation.parsed, userMessage);

    logger.info(`AI parsed "${userMessage}" → ${normalizedParsed.command} ${JSON.stringify(normalizedParsed.args)} (confidence: ${normalizedParsed.confidence})`);
    logger.debug(`AI reasoning: ${normalizedParsed.reasoning}`);
    lastSuccessTS = new Date().toISOString();
    lastErrorMessage = null;
    
    // Ensure summary exists and is short
    if (normalizedParsed.command !== 'chat' && normalizedParsed.summary.length === 0) {
      normalizedParsed.summary = 'Booth lights blinking; request locked in.';
    }
    
    // Clear context after successful parsing (user has moved on)
    if (normalizedParsed.confidence > 0.5) {
      clearUserContext(userName, scope);
    }
    
    return normalizedParsed;
    
  } catch (err) {
    logger.error('AI parsing error: ' + err.message);
    if (err.response) {
      logger.error('OpenAI API error: ' + JSON.stringify(err.response.data));
    }
    lastErrorTS = new Date().toISOString();
    lastErrorMessage = err.message;
    return null;
  }
}

/**
 * Check if AI parsing is enabled
 */
function isAIEnabled() {
  return isEnabled;
}

function getAIDebugInfo() {
  return {
    enabled: isEnabled,
    lastSuccessTS,
    lastErrorTS,
    lastErrorMessage,
    model: nconf.get('aiModel') || 'gpt-4o-mini',
    seasonal: getSeasonalContext(),
    defaultTheme: nconf.get('defaultTheme') || '(not set)',
    themePercentage: parseInt(nconf.get('themePercentage'), 10) || 0,
    aiMoodMirrorEnabled: isConfigEnabled('aiMoodMirrorEnabled')
  };
}

module.exports = {
  initialize,
  parseNaturalLanguage,
  isAIEnabled,
  getAIDebugInfo,
  setUserContext,
  getUserContext,
  clearUserContext,
  getSeasonalContext
};
