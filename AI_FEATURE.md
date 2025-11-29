# AI Natural Language Feature

## Overview

SlackONOS now supports natural language commands powered by OpenAI GPT-4o-mini. Users can @mention the bot and speak naturally instead of remembering exact command syntax.

## What's New

### Core Features
- 🤖 **Natural Language Processing** - Understands conversational requests
- 🌍 **Multi-Language Support** - Works in Swedish, English, and more
- ⚡ **Smart Routing** - Direct commands bypass AI for instant response
- 🔄 **Graceful Fallback** - Works without AI if no API key is provided
- 📊 **Confidence Scoring** - Only executes commands with high confidence (>50%)

### Examples

**Natural Language (with AI):**
```
@SlackONOS spela de bästa låtarna med U2
@bot add Forever Young
@SlackONOS what's playing right now?
@bot skip this terrible song
@SlackONOS show me the current queue
```

**Direct Commands (no AI needed):**
```
add Forever Young
bestof U2
current
gong
list
```

## Implementation Details

### New Files

**`ai-handler.js`**
- OpenAI client initialization
- Natural language parsing with GPT-4o-mini
- Confidence scoring and validation
- Comprehensive system prompts with command documentation

### Modified Files

**`package.json`**
- Added `openai: ^4.76.1` dependency

**`config/config.json.example`**
- Added `openaiApiKey` configuration field

**`index.js`**
- Imported AI handler module
- Created `handleNaturalLanguage()` function for AI parsing
- Created `routeCommand()` to intelligently route between AI and direct processing
- Updated Slack and Discord initialization to use command router
- Added AI initialization logging

**`README.md`**
- Added AI feature to key features list
- Added comprehensive AI usage section with examples
- Documented setup steps for OpenAI API key

## Configuration

### Required Setup

1. Get OpenAI API key from https://platform.openai.com/api-keys
2. Add to `config/config.json`:
```json
{
  "openaiApiKey": "sk-proj-YOUR_KEY_HERE"
}
```

### Optional

The AI feature is completely optional. If no `openaiApiKey` is provided:
- Bot logs: "AI natural language parsing is disabled (no API key)"
- @mentions still work but show help message for unknown input
- All direct commands work normally

## How It Works

### Request Flow

1. User sends message (e.g., "@bot play Queen")
2. `routeCommand()` checks if message starts with known command
   - **YES** → Direct to `processInput()` (instant, no AI)
   - **NO** → Send to `handleNaturalLanguage()`
3. AI parses natural language → structured command
4. Confidence check (must be ≥50%)
5. Execute parsed command via `processInput()`

### AI Prompt Engineering

The system prompt includes:
- Complete command list with descriptions
- Output format specification (JSON)
- Confidence scoring guidelines
- Multiple examples for accuracy
- Low temperature (0.3) for deterministic parsing

### Example Parsing

Input: `"spela de bästa låtarna med U2"`

AI Response:
```json
{
  "command": "bestof",
  "args": ["U2"],
  "confidence": 0.95,
  "reasoning": "Clear request for artist's best tracks"
}
```

Executed as: `bestof U2`

## Cost Considerations

**Per Request:**
- Model: GPT-4o-mini
- Input: ~400 tokens (system prompt + user message)
- Output: ~50 tokens (JSON response)
- Cost: ~$0.0001 per request

**Monthly Estimate (for typical usage):**
- 100 AI requests/day = $0.30/month
- 1000 AI requests/day = $3/month

**Note:** Direct commands don't use AI and cost nothing!

## Testing

### Manual Testing

```bash
# In Slack/Discord
@bot spela de bästa låtarna med Queen
@bot what's playing?
@bot skip this song
@bot lägg till Dancing Queen
```

### Logs to Check

```
[timestamp] info: 🤖 AI natural language parsing is ENABLED
[timestamp] info: ✅ Command router initialized with AI support
[timestamp] info: ✨ AI parsed: "spela de bästa låtarna med Queen" → bestof [Queen] (95%)
```

## Troubleshooting

### "AI parsing returned null"
- Check OpenAI API key is valid
- Verify API key has credits
- Check network connectivity

### "Low confidence"
- Message was too ambiguous
- Try being more specific
- Or use direct command syntax

### "AI disabled, falling back to standard processing"
- No `openaiApiKey` in config
- This is normal if you haven't set up OpenAI

## Future Enhancements

Potential improvements:
- [ ] Cache common requests to reduce API calls
- [ ] Add user-specific language preferences
- [ ] Support for playlist creation via conversation
- [ ] Multi-turn conversations for complex requests
- [ ] Local LLM support (Ollama) as alternative to OpenAI

## Branch Information

- **Branch:** `feature/ai-natural-language`
- **Base:** `master`
- **Status:** Ready for testing
- **Breaking Changes:** None (fully backward compatible)
