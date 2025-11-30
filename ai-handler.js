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

// User conversation context - keeps last suggestion for follow-ups
// Format: { userName: { lastSuggestion: 'command', timestamp: Date, context: 'string' } }
const userContext = {};
const CONTEXT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
 */
function setUserContext(userName, suggestion, context) {
  userContext[userName] = {
    lastSuggestion: suggestion,
    timestamp: Date.now(),
    context: context
  };
  logger.debug(`Set context for ${userName}: ${suggestion} - ${context}`);
}

/**
 * Get user context if still valid
 * @param {string} userName - Username
 * @returns {Object|null} - Context or null if expired
 */
function getUserContext(userName) {
  const ctx = userContext[userName];
  if (!ctx) return null;
  
  // Check if context has expired
  if (Date.now() - ctx.timestamp > CONTEXT_TIMEOUT_MS) {
    delete userContext[userName];
    return null;
  }
  
  return ctx;
}

/**
 * Clear user context
 * @param {string} userName - Username
 */
function clearUserContext(userName) {
  delete userContext[userName];
}

/**
 * Parse natural language message into structured command
 * @param {string} userMessage - The user's message (with @mention removed)
 * @param {string} userName - Username for context
 * @returns {Promise<{command: string, args: Array<string>, confidence: number, reasoning: string}|null>}
 */
async function parseNaturalLanguage(userMessage, userName) {
  if (!isEnabled || !openai) {
    logger.debug('AI parsing skipped - not enabled');
    return null;
  }
  
  // Check for follow-up context
  const ctx = getUserContext(userName);
  let contextInfo = '';
  if (ctx) {
    contextInfo = `\n\nIMPORTANT CONTEXT: The user's previous request was blocked because "${ctx.context}". They were suggested to use "${ctx.lastSuggestion}" instead. If the user says something like "ok", "yes", "do it", "sure", "gör det", "ja", "ok gör det", "kör", etc., they likely want to execute the suggested command "${ctx.lastSuggestion}".`;
    logger.debug(`Using context for ${userName}: ${ctx.lastSuggestion}`);
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
  
  const seasonalInfo = `\n\nSEASONAL CONTEXT: Current date is ${seasonal.month}. Season: ${seasonal.season}.
Relevant music themes for this time: ${seasonal.themes.join(', ')}.
${seasonal.suggestion}
If the user asks for seasonal, thematic, or mood-based music (e.g., "add some seasonal music", "play something festive", "lägg till säsongsmusik", "spela nåt passande"), suggest music that fits the current season/theme. For bulk requests like "add 100 songs" or "fyll på listan", consider mixing in some seasonal tracks (around 20-30%) with regular popular music.${venueInfo}`;
  
  const systemPrompt = `You are a music bot command parser for SlackONOS. Convert natural language requests into structured commands.

Available commands:
- add <song/artist/album> - Add music to queue (searches Spotify)
- bestof <artist> - Add top 10 tracks by an artist
- search <query> - Search Spotify without adding to queue
- gong - Vote to skip current track
- vote <track_number> - Vote for a queued track to play sooner
- current - Show currently playing track
- list - Show queue
- volume - Show current volume
- next - Skip to next track (admin only)
- previous - Go to previous track (admin only)
- play - Resume playback (admin only)
- stop - Stop playback (admin only)
- flush - Clear queue (admin only)
- help - Show available commands

Parse the user's message and respond ONLY with valid JSON in this exact format:
{
  "command": "command_name",
  "args": ["arg1", "arg2"],
  "confidence": 0.95,
  "reasoning": "Brief explanation of parsing",
  "summary": "Short, funny DJ-style one-liner confirming the action",
  "followUp": null
}

IMPORTANT - MULTI-STEP REQUESTS: When user asks to do TWO things (like "clear AND add", "rensa OCH lägg till", "flush then play"), you MUST use the followUp field:
{
  "command": "flush",
  "args": [],
  "confidence": 0.95,
  "reasoning": "User wants to clear queue first, then add songs",
  "summary": "Clearing the decks! Let's make room for fresh beats!",
  "followUp": {
    "command": "add",
    "args": ["popular hits", "100"],
    "reasoning": "Second part: add 100 songs after flush"
  }
}

Rules:
- confidence should be 0.0 to 1.0 (use 0.9+ for clear requests, 0.5-0.8 for ambiguous, <0.5 for unclear)
- For "add" and "search": extract ONLY the song/artist/album name as the first argument (remove filler words like "songs by", "tracks from", "music of", "great", "best", "good")
- For "add" and "search": if user implies quantity (e.g., "some", "a couple", "few", "several", "great songs", "good tracks", or a number), include count as second argument (default 5 for vague quantities)
- For "bestof": extract artist name only; if user asks for top N (e.g., "top three", "best 3"), include N as second argument (number)
- For "vote": extract track number if mentioned
- For commands without arguments (gong, current, list, etc): use empty args array
- Always use lowercase command names
- If request is unclear or not music-related, return low confidence (<0.4)
- Use followUp for multi-step requests like "clear queue and add songs" or "rensa och fyll på"

Examples:
User: "spela de bästa låtarna med U2" → {"command": "bestof", "args": ["U2"], "confidence": 0.95, "reasoning": "Clear request for artist's best tracks", "followUp": null}
User: "add some great songs of Foo Fighters" → {"command": "add", "args": ["Foo Fighters", "5"], "confidence": 0.95, "reasoning": "Request for multiple tracks by artist, using default count 5", "followUp": null}
User: "play some Queen" → {"command": "add", "args": ["Queen", "5"], "confidence": 0.92, "reasoning": "Vague quantity, defaulting to 5 tracks", "followUp": null}
User: "lägg till Forever Young" → {"command": "add", "args": ["Forever Young"], "confidence": 0.92, "reasoning": "Add single track", "followUp": null}
User: "skippa den här skiten" → {"command": "gong", "args": [], "confidence": 0.88, "reasoning": "Slang for skipping track", "followUp": null}
User: "vad spelas nu?" → {"command": "current", "args": [], "confidence": 0.95, "reasoning": "Asking for current track", "followUp": null}
User: "hur är vädret?" → {"command": "help", "args": [], "confidence": 0.3, "reasoning": "Not music-related, suggesting help", "followUp": null}
User: "play the best three songs by Foo Fighters" → {"command": "bestof", "args": ["Foo Fighters", "3"], "confidence": 0.95, "reasoning": "Top-N request for artist", "followUp": null}
User: "lägg till lite säsongsmusik" → {"command": "add", "args": ["[seasonal theme based on current month]", "5"], "confidence": 0.9, "reasoning": "Seasonal music request, using current season theme", "followUp": null}
User: "rensa listan och lägg till 100 låtar" → {"command": "flush", "args": [], "confidence": 0.95, "reasoning": "Clear queue first", "summary": "Clearing the decks!", "followUp": {"command": "add", "args": ["popular hits", "100"], "reasoning": "Then add 100 songs"}}
User: "töm kön och fyll på med jullåtar" → {"command": "flush", "args": [], "confidence": 0.95, "reasoning": "Clear queue first", "summary": "Out with the old!", "followUp": {"command": "add", "args": ["christmas songs", "50"], "reasoning": "Then add christmas music"}}${seasonalInfo}${contextInfo}`

  const userPrompt = `User: ${userName}
Message: "${userMessage}"

Parse this into a command.`;

  try {
    logger.debug(`AI parsing request from ${userName}: "${userMessage}"`);
    
    const djPrompt = nconf.get('aiPrompt') || 'You are a funny, upbeat DJ. Reply with a super short, playful one-liner about what you\'ll do.';
    const aiModel = nconf.get('aiModel') || 'gpt-4o';

    const response = await openai.chat.completions.create({
      model: aiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `DJ Style: ${djPrompt}` },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more deterministic parsing
      max_tokens: 350, // Increased for multi-step commands with followUp
      response_format: { type: 'json_object' }
    });
    
    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);
    
    logger.info(`AI parsed "${userMessage}" → ${parsed.command} ${JSON.stringify(parsed.args)} (confidence: ${parsed.confidence})`);
    logger.debug(`AI reasoning: ${parsed.reasoning}`);
    lastSuccessTS = new Date().toISOString();
    lastErrorMessage = null;
    
    // Validate parsed response
    if (!parsed.command || !Array.isArray(parsed.args) || typeof parsed.confidence !== 'number') {
      logger.warn('AI returned invalid format: ' + content);
      return null;
    }
    
    // Ensure summary exists and is short
    if (typeof parsed.summary !== 'string' || parsed.summary.length === 0) {
      parsed.summary = '🎧 Got it! Spinning those tunes now!';
    } else {
      parsed.summary = parsed.summary.slice(0, 160);
    }
    
    // Clear context after successful parsing (user has moved on)
    if (parsed.confidence > 0.5) {
      clearUserContext(userName);
    }
    
    return parsed;
    
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
    model: nconf.get('aiModel') || 'gpt-4o',
    seasonal: getSeasonalContext(),
    defaultTheme: nconf.get('defaultTheme') || '(not set)',
    themePercentage: parseInt(nconf.get('themePercentage'), 10) || 0
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
