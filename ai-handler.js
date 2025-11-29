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
  "reasoning": "Brief explanation of parsing"
}

Rules:
- confidence should be 0.0 to 1.0 (use 0.9+ for clear requests, 0.5-0.8 for ambiguous, <0.5 for unclear)
- For "add" and "search": extract the song/artist/album as a single argument
- For "bestof": extract artist name
- For "vote": extract track number if mentioned
- For commands without arguments (gong, current, list, etc): use empty args array
- Always use lowercase command names
- If request is unclear or not music-related, return low confidence (<0.4)

Examples:
User: "spela de bästa låtarna med U2" → {"command": "bestof", "args": ["U2"], "confidence": 0.95, "reasoning": "Clear request for artist's best tracks"}
User: "lägg till Forever Young" → {"command": "add", "args": ["Forever Young"], "confidence": 0.92, "reasoning": "Add single track"}
User: "skippa den här skiten" → {"command": "gong", "args": [], "confidence": 0.88, "reasoning": "Slang for skipping track"}
User: "vad spelas nu?" → {"command": "current", "args": [], "confidence": 0.95, "reasoning": "Asking for current track"}
User: "hur är vädret?" → {"command": "help", "args": [], "confidence": 0.3, "reasoning": "Not music-related, suggesting help"}`;

  const userPrompt = `User: ${userName}
Message: "${userMessage}"

Parse this into a command.`;

  try {
    logger.debug(`AI parsing request from ${userName}: "${userMessage}"`);
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temperature for more deterministic parsing
      max_tokens: 200,
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
    model: 'gpt-4o-mini'
  };
}

module.exports = {
  initialize,
  parseNaturalLanguage,
  isAIEnabled,
  getAIDebugInfo
};
