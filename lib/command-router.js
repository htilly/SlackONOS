/**
 * Command router for SlackONOS.
 *
 * This module owns input cleanup, alias resolution, admin gating, AI natural
 * language routing, and dispatch into the command registry. Command
 * implementations still live in their dedicated modules or index.js.
 */

function buildAliasMap(commandRegistry) {
  const aliasMap = new Map();
  for (const [cmd, meta] of commandRegistry) {
    const aliases = meta.aliases || [];
    aliases.forEach(alias => aliasMap.set(alias.toLowerCase(), cmd));
  }
  return aliasMap;
}

function cleanCommandText(text) {
  text = (text || '').trim();
  text = text.replace(/^(&gt;|>)\s*/, '');
  text = text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  text = text.replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1').replace(/`([^`]+)`/g, '$1');
  text = text.replace(/[`_]/g, '');
  text = text.replace(/^\d+\.\s*/, '');
  text = text.replace(/^(&gt;|>)\s*/, '');
  return text.trim();
}

function noop() {}

function elapsedMs(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1000000);
}

function createCommandRouter(deps) {
  const {
    logger = { info: noop, warn: noop, error: noop, debug: noop },
    commandRegistry,
    AIHandler,
    musicHelper,
    sonos,
    config,
    sendMessage,
    appendAIUnparsed,
    parseArgs,
    normalizeUser,
    isBlacklisted,
    setContext,
    messageTimestamps,
    getAdminChannel,
    getUserMusicProfile,
    getUserInteractionProfile,
    logUserAction,
  } = deps;

  if (!commandRegistry) {
    throw new Error('Command router requires commandRegistry');
  }
  if (!sendMessage) {
    throw new Error('Command router requires sendMessage');
  }
  if (!parseArgs) {
    throw new Error('Command router requires parseArgs');
  }
  if (!normalizeUser) {
    throw new Error('Command router requires normalizeUser');
  }

  const aliasMap = buildAliasMap(commandRegistry);
  const getAdminChannelId = getAdminChannel || (() => null);
  const updateContext = setContext || noop;
  const writeAIUnparsed = appendAIUnparsed || (async () => {});
  const userIsBlacklisted = isBlacklisted || (() => false);
  const readUserMusicProfile = getUserMusicProfile || (async () => '');
  const readUserInteractionProfile = getUserInteractionProfile || (async () => '');
  const recordUserAction = logUserAction || (async () => {});

  function isKnownCommand(command) {
    return commandRegistry.has(command) || aliasMap.has(command);
  }

  function resolveCommand(command) {
    return commandRegistry.has(command) ? command : aliasMap.get(command);
  }

  function getAIContextScope(platform, channel) {
    return { platform, channel };
  }

  function getCommandMeta(command) {
    const cmdKey = resolveCommand(command);
    return cmdKey ? { cmdKey, cmdMeta: commandRegistry.get(cmdKey) } : null;
  }

  function isAuthorizedCommand(command, channel, platform, isAdmin) {
    const resolved = getCommandMeta(command);
    if (!resolved || !resolved.cmdMeta) return false;
    if (!resolved.cmdMeta.admin) return true;
    return platform === 'discord' ? isAdmin : channel === getAdminChannelId();
  }

  function normalizeParsedMusicIntent(parsed, cleanText) {
    if (!parsed || parsed.command !== 'play') {
      return parsed;
    }

    const match = String(cleanText || '').trim().match(/^play\s+(.+)/i);
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

    if (Array.isArray(parsed.args) && parsed.args.length > 0) {
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

    return {
      ...parsed,
      command: 'add',
      args: [query, count],
      reasoning: `${parsed.reasoning || 'Music request'}; interpreted "play ..." with music descriptors as queueing music.`,
      summary: parsed.summary || `DJ radar locked on ${query}.`,
      targetType: parsed.targetType || 'unknown'
    };
  }

  function buildParsedIntentDetails(parsed, cleanText) {
    const args = Array.isArray(parsed.args) ? parsed.args : [];
    let query = args.join(' ').trim();
    let requestedCount = null;

    if (args.length > 0) {
      const maybeCount = parseInt(args[args.length - 1], 10);
      if (!Number.isNaN(maybeCount) && String(args[args.length - 1]).match(/^\d+$/)) {
        requestedCount = maybeCount;
        query = args.slice(0, -1).join(' ').trim();
      }
    }

    if (!query && cleanText) {
      query = cleanText;
    }

    const details = {
      source: 'ai_intent',
      type: parsed.command,
      targetType: parsed.targetType || 'unknown',
      countStats: false
    };

    if (query) {
      details.query = query;
    }
    if (requestedCount !== null) {
      details.requestedCount = requestedCount;
    }
    if (typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)) {
      details.confidence = parsed.confidence;
    }

    return details;
  }

  function classifyInteractionTone(text) {
    const message = String(text || '').trim();
    const lower = message.toLowerCase();
    let score = 0;

    if (/\b(please|pls|thank you|thanks|thx|appreciate|kindly|snälla|tack|gärna)\b/i.test(lower)) {
      score += 2;
    }
    if (/\b(haha|lol|lmao|hehe|fun|funny|awesome|great|love|nice one|let'?s go|gooo)\b/i.test(lower) || /[:;]-?[d)]/i.test(message)) {
      score += 1;
    }
    if (/\b(now|asap|hurry|just do it|fix it|do it|come on|wtf|ffs)\b/i.test(lower)) {
      score -= 1;
    }
    if (/[!?]{3,}/.test(message)) {
      score -= 1;
    }
    if (/\b(idiot|stupid|dumb|useless|trash|sucks|shut up|fuck|fucking|shit|jävla|skit|fan)\b/i.test(lower)) {
      score -= 3;
    }

    const letters = message.replace(/[^a-z]/gi, '');
    const upper = message.replace(/[^A-Z]/g, '');
    if (letters.length >= 8 && upper.length / letters.length > 0.7) {
      score -= 1;
    }

    score = Math.max(-5, Math.min(5, score));
    let mood = 'neutral';
    if (score >= 3) {
      mood = 'warm';
    } else if (score >= 1) {
      mood = /\b(haha|lol|lmao|hehe|fun|funny|let'?s go|gooo)\b/i.test(lower) ? 'playful' : 'warm';
    } else if (score <= -4) {
      mood = 'rude';
    } else if (score <= -1) {
      mood = 'impatient';
    }

    return { mood, kindnessScore: score };
  }

  async function recordParsedIntent(userName, parsed, cleanText, interactionTone = null) {
    if (!parsed) {
      return;
    }

    try {
      const details = buildParsedIntentDetails(parsed, cleanText);
      if (interactionTone) {
        details.mood = interactionTone.mood;
        details.kindnessScore = interactionTone.kindnessScore;
      }
      await recordUserAction(userName, 'ai_intent', details);
    } catch (err) {
      logger.debug(`Could not record AI intent for ${userName}: ${err.message}`);
    }
  }

  function notifyRegionErrors(result, channel) {
    const regionErrors = result.skipped?.filter(track => track.errorCode === '800') || [];
    const adminChannel = getAdminChannelId();
    if (regionErrors.length === 0 || !adminChannel) {
      return;
    }

    const currentMarket = config.get('market') || 'US';
    const marketOptions = ['US', 'SE', 'GB', 'DE', 'FR', 'CA', 'AU', 'JP', 'NO', 'DK', 'FI'];
    const marketOptionsList = marketOptions.map(m => m === currentMarket ? `*${m}* (current)` : m).join(', ');

    sendMessage(
      `⚠️ *Spotify Region Warning*\n` +
      `${regionErrors.length} track(s) failed due to region availability:\n` +
      `${regionErrors.slice(0, 3).map(t => `• *${t.name}* by ${t.artist}`).join('\n')}${regionErrors.length > 3 ? `\n... and ${regionErrors.length - 3} more` : ''}\n\n` +
      `Please verify your Spotify region configuration.\n` +
      `Current region: *${currentMarket}*\n` +
      `Available options: ${marketOptionsList}\n` +
      `Update via setup wizard or admin panel.`,
      adminChannel
    );
  }

  function formatQueuedTrack(track, index) {
    const name = track?.name || track?.title || 'Unknown track';
    const artist = track?.artist || track?.artists?.join(', ') || 'Unknown artist';
    return `${index + 1}. *${name}* by ${artist}`;
  }

  function sanitizeReasonText(text, maxLength = 180) {
    return String(text || '')
      .replace(/[\r\n`]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  function buildDjReply(text, fallback = 'DJ circuits are glowing. I am on it.') {
    const clean = sanitizeReasonText(text, 500) || fallback;
    return clean.startsWith('🎧') ? clean : `🎧 ${clean}`;
  }

  function buildDjIntro(parsed = null, query = '') {
    const summary = sanitizeReasonText(parsed?.summary);
    if (summary) {
      return buildDjReply(summary);
    }

    return buildDjReply(`DJ circuits are glowing: launching "${query}" into the room.`);
  }

  function buildSelectionReason(result, query, parsed = null) {
    if (Array.isArray(result.appliedBoosters) && result.appliedBoosters.length > 0) {
      return `I heard "${query}" and cranked the Spotify radar toward ${result.appliedBoosters.join(', ')}, so this queue leans into that vibe instead of random jukebox soup.`;
    }

    const reasoning = sanitizeReasonText(parsed?.reasoning);
    if (reasoning) {
      return `My booth brain read it as: ${reasoning}`;
    }

    return `I grabbed the strongest Spotify matches for the "${query}" vibe and stacked them for lift-off.`;
  }

  function buildMultiAddMessage(result, query, actionMessage = 'Added', parsed = null) {
    let msg = `${buildDjIntro(parsed, query)}\n🎵 ${actionMessage} ${result.added} tracks`;
    if (result.themeCount > 0) {
      const defaultTheme = config.get('defaultTheme') || '';
      msg += ` (${result.mainCount} "${query}" + ${result.themeCount} "${defaultTheme}")`;
    } else {
      msg += ` for "${query}"`;
    }
    msg += ' 🎉';

    const reason = buildSelectionReason(result, query, parsed);
    if (reason) {
      msg += `\n${reason}`;
    }

    const queuedTracks = Array.isArray(result.queuedTracks) && result.queuedTracks.length > 0
      ? result.queuedTracks
      : (Array.isArray(result.tracks) ? result.tracks.slice(0, result.added) : []);
    if (queuedTracks.length > 0) {
      const list = queuedTracks.slice(0, 8).map(formatQueuedTrack).join('\n');
      const moreText = queuedTracks.length > 8 ? `\n...and ${queuedTracks.length - 8} more` : '';
      msg += `\nAdded:\n${list}${moreText}`;
    }

    if (result.skipped && result.skipped.length > 0) {
      const skippedList = result.skipped.slice(0, 5).map(track => `*${track.name}*`).join(', ');
      const moreText = result.skipped.length > 5 ? ` and ${result.skipped.length - 5} more` : '';
      msg += `\n⚠️ Skipped ${result.skipped.length} blacklisted track(s): ${skippedList}${moreText}`;
    }

    return msg;
  }

  async function queueAITrackBatch(parsed, args, cleanText, channel, platform, userName, actionMessage = null) {
    let finalArgs = args;

    if (parsed.command === 'add' && finalArgs.length === 1) {
      const match = finalArgs[0].match(/^\s*(\d{1,2})\s+(.+)$/);
      if (match) {
        finalArgs = [match[2].replace(/[!]+$/, '').trim(), match[1]];
        logger.info(`AI add: extracted leading count ${match[1]} and query "${finalArgs[0]}"`);
      } else if (/(some|couple|few|several)/i.test(cleanText)) {
        finalArgs.push('5');
        logger.info('AI add: vague quantity detected → defaulting to count 5');
      }
    }

    if (parsed.command !== 'add' || finalArgs.length < 2) {
      return { handled: false, args: finalArgs };
    }

    let maybeCount = parseInt(finalArgs[finalArgs.length - 1], 10);
    const adminChannel = getAdminChannelId();
    const isAdminChannel = channel === adminChannel;
    const maxTracks = isAdminChannel ? 200 : 20;

    if (isNaN(maybeCount) || maybeCount <= 1) {
      logger.info(`AI add: count argument not valid → ${finalArgs[finalArgs.length - 1]}`);
      return { handled: false, args: finalArgs };
    }

    if (maybeCount > maxTracks) {
      logger.info(`AI add: requested ${maybeCount} tracks, capping to ${maxTracks} (admin=${isAdminChannel})`);
      maybeCount = maxTracks;
      if (!isAdminChannel) {
        await sendMessage(buildDjReply(`Booth limiter kicked in: capped this at ${maxTracks} tracks here. Admin channel can go louder.`), channel);
      }
    }

    const query = finalArgs.slice(0, -1).join(' ');
    const result = await musicHelper.searchAndQueue(sonos, query, maybeCount, {
      useTheme: isAdminChannel,
      targetType: parsed.targetType || 'unknown'
    });

    if (!result.added) {
      await sendMessage(buildDjReply(`Spotify radar found zero tracks for "${query}". Give me a sharper crate-digging clue.`), channel);
      return { handled: true, args: finalArgs };
    }

    recordUserAction(userName, 'add', {
      query,
      source: 'ai_batch',
      requestedCount: maybeCount,
      addedCount: result.added
    });

    const resolvedActionMessage = actionMessage || (result.wasPlaying ? 'Added' : 'Started fresh with');
    const sendStart = process.hrtime.bigint();
    await sendMessage(buildMultiAddMessage(result, query, resolvedActionMessage, parsed), channel);
    logger.info(`[AI_TIMING] batch_send command=add query="${query}" added=${result.added} ms=${elapsedMs(sendStart)}`);
    notifyRegionErrors(result, channel);
    return { handled: true, args: finalArgs };
  }

  async function handleNaturalLanguage(text, channel, userName, platform = 'slack', isAdmin = false) {
    const totalStart = process.hrtime.bigint();
    logger.info(`>>> handleNaturalLanguage called with: "${text}"`);
    updateContext(platform, channel, isAdmin);
    const aiContextScope = getAIContextScope(platform, channel);

    const cleanText = text.replace(/<@[^>]+>/g, '').trim();
    logger.info(`>>> cleanText after stripping mention: "${cleanText}"`);
    const interactionTone = classifyInteractionTone(cleanText);
    const moodMirrorEnabled = config.get('aiMoodMirrorEnabled') === true;

    const firstWord = cleanText.split(/\s+/)[0].toLowerCase();
    const restOfText = cleanText.slice(firstWord.length).trim().toLowerCase();
    const naturalLangPattern = /\b(some|couple|few|several|good|best|nice|great|top|tunes|songs|music|tracks|for a|for the)\b/i;
    const looksLikeNaturalLang = naturalLangPattern.test(restOfText);
    logger.info(`>>> firstWord="${firstWord}", looksLikeNaturalLang=${looksLikeNaturalLang}`);

    if (isKnownCommand(firstWord)) {
      const cmdKey = resolveCommand(firstWord);
      const cmdMeta = commandRegistry.get(cmdKey);
      if (cmdMeta && cmdMeta.admin && !looksLikeNaturalLang) {
        logger.info(`>>> Skipping AI - admin command "${firstWord}" should be processed directly`);
        return processInput(cleanText, channel, userName, platform, isAdmin);
      }
    }

    if (isKnownCommand(firstWord) && !looksLikeNaturalLang) {
      logger.info(`>>> Skipping AI - known command "${firstWord}" without natural language`);
      return processInput(cleanText, channel, userName, platform, isAdmin);
    }

    if (isKnownCommand(firstWord)) {
      logger.info(`>>> Proceeding to AI despite command "${firstWord}" because it looks like natural language`);
    }

    if (!AIHandler.isAIEnabled()) {
      logger.debug('AI disabled, falling back to standard processing');
      await sendMessage(buildDjReply('Booth brain is offline, so I need command syntax: add song-name, bestof artist, gong, current, or help.'), channel);
      await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, reason: 'ai_disabled' });
      return;
    }

    try {
      let parsed = null;
      const ctx = AIHandler.getUserContext(userName, aiContextScope);
      if (ctx) {
        const confirmationPattern = /\b(ok|yes|do it|sure|yeah|yep|please|go ahead|play it|gör det|ja|kör|varsågod|snälla|spela|absolutely|definitely|sounds good|let's do it|let's go)\b/i;
        const isShortAffirmative = /^[\s\w!.,?-]{1,30}$/i.test(cleanText) && confirmationPattern.test(cleanText);

        if (isShortAffirmative || confirmationPattern.test(cleanText)) {
          if (ctx.suggestedAction) {
            logger.info(`User "${userName}" confirmed suggested action: ${ctx.suggestedAction.command} ${ctx.suggestedAction.args.join(' ')}`);
            parsed = {
              command: ctx.suggestedAction.command,
              args: ctx.suggestedAction.args,
              confidence: 0.95,
              reasoning: 'User confirmed previous suggestion',
              summary: 'Booth confirmed; the suggested groove is launching.'
            };
          } else if (ctx.lastSuggestion) {
            logger.info(`User "${userName}" confirmed last suggestion: ${ctx.lastSuggestion}`);
            const parts = ctx.lastSuggestion.trim().split(/\s+/);
            parsed = {
              command: parts[0] || 'add',
              args: parts.slice(1),
              confidence: 0.95,
              reasoning: 'User confirmed previous suggestion',
              summary: 'Booth confirmed; the suggested groove is launching.'
            };
          }

          if (parsed) {
            AIHandler.clearUserContext(userName, aiContextScope);
          }
        }
      }

      if (!parsed) {
        let personalContext = '';
        let interactionContext = '';
        let personalContextMs = 0;
        let interactionContextMs = 0;
        let aiParseMs = 0;
        try {
          const personalStart = process.hrtime.bigint();
          personalContext = await readUserMusicProfile(userName);
          personalContextMs = elapsedMs(personalStart);
        } catch (profileErr) {
          logger.debug(`Could not load AI music profile for ${userName}: ${profileErr.message}`);
        }
        if (moodMirrorEnabled) {
          try {
            const interactionStart = process.hrtime.bigint();
            interactionContext = await readUserInteractionProfile(userName);
            interactionContextMs = elapsedMs(interactionStart);
          } catch (profileErr) {
            logger.debug(`Could not load AI interaction profile for ${userName}: ${profileErr.message}`);
          }
        }

        const aiParseStart = process.hrtime.bigint();
        parsed = await AIHandler.parseNaturalLanguage(cleanText, userName, {
          ...aiContextScope,
          personalContext,
          interactionTone: moodMirrorEnabled ? interactionTone : null,
          interactionContext: moodMirrorEnabled ? interactionContext : ''
        });
        aiParseMs = elapsedMs(aiParseStart);
        logger.info(
          `[AI_TIMING] route_parse user=${userName} command=${parsed?.command || 'null'} confidence=${parsed?.confidence ?? 'n/a'} ` +
          `personalContextMs=${personalContextMs} interactionContextMs=${interactionContextMs} aiParseMs=${aiParseMs} totalMs=${elapsedMs(totalStart)}`
        );

        if (!parsed) {
          logger.warn(`AI parsing returned null for: "${cleanText}"`);
          await sendMessage(buildDjReply('My booth brain lost the beat on that one. Try help or give me a clearer music move.'), channel);
          await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, reasoning: 'none', reason: 'parse_null' });
          return;
        }

        if (parsed.command === 'chat' && parsed.response) {
          logger.info(`AI chat response: "${cleanText}" → "${parsed.response}"`);
          await recordParsedIntent(userName, parsed, cleanText, interactionTone);
          const chatSendStart = process.hrtime.bigint();
          await sendMessage(buildDjReply(parsed.response), channel);

          if (parsed.suggestedAction && parsed.suggestedAction.command) {
            if (isKnownCommand(parsed.suggestedAction.command) &&
                isAuthorizedCommand(parsed.suggestedAction.command, channel, platform, isAdmin)) {
              const suggestion = `${parsed.suggestedAction.command} ${parsed.suggestedAction.args.join(' ')}`;
              const description = parsed.suggestedAction.description || suggestion;
              AIHandler.setUserContext(userName, suggestion, `offered to play ${description}`, parsed.suggestedAction, aiContextScope);
              logger.info(`Chat suggestion saved for ${userName}: "${suggestion}" (${description})`);
            } else {
              logger.warn(`Discarding unauthorized or unknown suggested action: ${parsed.suggestedAction.command}`);
            }
          }
          logger.info(`[AI_TIMING] route_complete type=chat command=chat sendMs=${elapsedMs(chatSendStart)} totalMs=${elapsedMs(totalStart)}`);
          return;
        }

        if (parsed.confidence < 0.5) {
          logger.info(`Low confidence (${parsed.confidence}) for: "${cleanText}" → ${parsed.command}`);
          await sendMessage(buildDjReply(`Booth needle is wobbling. Did you mean ${parsed.command} ${parsed.args.join(' ')}? Try help for the command deck.`), channel);
          await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, parsed, reasoning: parsed.reasoning, reason: 'low_confidence' });
          return;
        }

        parsed = normalizeParsedMusicIntent(parsed, cleanText);
        logger.info(`✨ AI parsed: "${cleanText}" → ${parsed.command} [${parsed.args.join(', ')}] (${(parsed.confidence * 100).toFixed(0)}%)`);
      } else {
        parsed = normalizeParsedMusicIntent(parsed, cleanText);
      }

      if (!isKnownCommand(parsed.command)) {
        logger.warn(`AI returned unsupported command "${parsed.command}" for: "${cleanText}"`);
        await sendMessage(buildDjReply('I caught the vibe, but my deck mapped it to a move I cannot run. Try help for the real buttons.'), channel);
        await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, parsed, reasoning: parsed.reasoning, reason: 'unknown_ai_command' });
        return;
      }

      let finalArgs = parsed.args;
      if (parsed.command === 'add' && finalArgs.length > 0) {
        let term = finalArgs[0];
        term = term.replace(/\s+med\s+/i, ' ');
        term = term.replace(/\s+by\s+/i, ' ');
        term = term.replace(/[!]+$/, '');
        finalArgs[0] = term.trim();
        logger.info(`Track to add: ${finalArgs[0]}`);
      }
      await recordParsedIntent(userName, { ...parsed, args: finalArgs }, cleanText, interactionTone);

      try {
        const batchStart = process.hrtime.bigint();
        const batchResult = await queueAITrackBatch(parsed, finalArgs, cleanText, channel, platform, userName);
        const batchMs = elapsedMs(batchStart);
        if (batchResult.handled) {
          logger.info(`[AI_TIMING] route_complete type=batch command=${parsed.command} batchMs=${batchMs} totalMs=${elapsedMs(totalStart)}`);
          return;
        }
        finalArgs = batchResult.args;
      } catch (err) {
        logger.error('Multi-add failed: ' + err.message);
        await sendMessage(buildDjReply('The queue crane jammed while stacking tracks. Try again or give me a tighter search.'), channel);
        return;
      }

      const commandText = finalArgs.length > 0
        ? `${parsed.command} ${finalArgs.join(' ')}`
        : parsed.command;
      const commandStart = process.hrtime.bigint();
      const primaryResult = await processInput(commandText, channel, userName, platform, isAdmin);
      const commandMs = elapsedMs(commandStart);
      let summarySendMs = 0;
      if (primaryResult && primaryResult.executed && parsed.summary) {
        const summarySendStart = process.hrtime.bigint();
        await sendMessage(buildDjReply(parsed.summary), channel);
        summarySendMs = elapsedMs(summarySendStart);
      }
      logger.info(`[AI_TIMING] route_command command=${parsed.command} executed=${!!primaryResult?.executed} commandMs=${commandMs} summarySendMs=${summarySendMs} totalMs=${elapsedMs(totalStart)}`);

      if (parsed.followUp && parsed.followUp.command) {
        if (!primaryResult || !primaryResult.executed) {
          logger.info(`Skipping followUp command because primary command did not execute: ${parsed.command}`);
          return;
        }

        if (!isKnownCommand(parsed.followUp.command)) {
          logger.warn(`Skipping unsupported followUp command: ${parsed.followUp.command}`);
          return;
        }

        logger.info(`>>> Processing followUp command: ${parsed.followUp.command} [${(parsed.followUp.args || []).join(', ')}]`);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const followUpParsed = {
          command: parsed.followUp.command,
          args: parsed.followUp.args || [],
          confidence: parsed.confidence,
          reasoning: parsed.followUp.reasoning || 'followUp command',
          summary: null,
          targetType: parsed.followUp.targetType || 'unknown'
        };

        let followUpArgs = followUpParsed.args;
        if (followUpParsed.command === 'add' && followUpArgs.length >= 1) {
          let maybeCount = parseInt(followUpArgs[followUpArgs.length - 1], 10);
          const adminChannel = getAdminChannelId();
          const isAdminChannel = channel === adminChannel;
          const maxTracks = isAdminChannel ? 200 : 20;

          if (!isNaN(maybeCount) && maybeCount > 1) {
            if (maybeCount > maxTracks) {
              logger.info(`FollowUp add: requested ${maybeCount} tracks, capping to ${maxTracks} (admin=${isAdminChannel})`);
              maybeCount = maxTracks;
              if (!isAdminChannel) {
                await sendMessage(buildDjReply(`Booth limiter kicked in: capped this at ${maxTracks} tracks here. Admin channel can go louder.`), channel);
              }
            }

            const defaultTheme = config.get('defaultTheme') || 'popular hits';
            const query = followUpArgs.slice(0, -1).join(' ') || defaultTheme;

            try {
              const result = await musicHelper.searchAndQueue(sonos, query, maybeCount, {
                useTheme: isAdminChannel,
                targetType: followUpParsed.targetType || 'unknown'
              });

              if (!result.added) {
                await sendMessage(buildDjReply(`Follow-up radar found zero tracks for "${query}". Toss me a fresher clue.`), channel);
                return;
              }

              notifyRegionErrors(result, channel);
              recordUserAction(userName, 'add', {
                query,
                source: 'ai_followup',
                requestedCount: maybeCount,
                addedCount: result.added
              });
              const followUpSendStart = process.hrtime.bigint();
              await sendMessage(buildMultiAddMessage(result, query, 'Added', followUpParsed), channel);
              logger.info(`[AI_TIMING] route_complete type=followup_add command=${parsed.command} followUp=${followUpParsed.command} sendMs=${elapsedMs(followUpSendStart)} totalMs=${elapsedMs(totalStart)}`);
              return;
            } catch (err) {
              logger.error('FollowUp multi-add failed: ' + err.message);
              await sendMessage(buildDjReply('The follow-up track stack slipped off the turntable. Try that add again.'), channel);
              return;
            }
          }
        }

        const followUpText = followUpArgs.length > 0
          ? `${followUpParsed.command} ${followUpArgs.join(' ')}`
          : followUpParsed.command;
        await processInput(followUpText, channel, userName, platform, isAdmin);
      }
    } catch (err) {
      logger.error(`Error in AI natural language handler: ${err.message}`);
      await sendMessage(buildDjReply('Smoke puff from the booth brain. Something broke; try a direct command while I recover.'), channel);
      await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, error: err.message, reason: 'handler_error' });
    }
  }

  async function routeCommand(text, channel, userName, platform = 'slack', isAdmin = false, isMention = false, messageTs = null) {
    logger.info(`>>> routeCommand: text="${text}", isMention=${isMention}`);

    if (messageTs && platform === 'slack' && messageTimestamps) {
      messageTimestamps.set(channel, messageTs);
      logger.debug(`Stored message timestamp ${messageTs} for channel ${channel}`);
    }

    text = cleanCommandText(text);
    logger.info(`>>> routeCommand: cleaned text="${text}"`);

    const trimmed = text.replace(/<@[^>]+>/g, '').trim();
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();

    if (isMention) {
      logger.info('>>> Mention detected, routing to handleNaturalLanguage');
      return handleNaturalLanguage(text, channel, userName, platform, isAdmin);
    }

    if (isKnownCommand(firstWord)) {
      return processInput(text, channel, userName, platform, isAdmin);
    }

    logger.debug(`Ignoring unknown command from non-mention: "${firstWord}"`);
  }

  async function processInput(text, channel, userName, platform = 'slack', isAdmin = false) {
    updateContext(platform, channel, isAdmin);

    if (!text || typeof text !== 'string') {
      logger.warn('processInput called without text');
      return { handled: false, executed: false, reason: 'missing_text' };
    }

    text = text.trim();
    text = text.replace(/^<@[^>]+>\s*/, '').trim();

    const args = parseArgs(text);
    if (args.length === 0) return { handled: false, executed: false, reason: 'empty_args' };

    const rawTerm = args[0].toLowerCase();
    const cmdKey = resolveCommand(rawTerm);

    if (!cmdKey) {
      logger.info(`Unknown command "${rawTerm}" from ${userName} in ${channel} [${platform}]`);
      return { handled: false, executed: false, reason: 'unknown_command' };
    }

    const cmdMeta = commandRegistry.get(cmdKey);
    if (!cmdMeta) {
      logger.error(`Command metadata missing for ${cmdKey}`);
      return { handled: false, executed: false, reason: 'missing_command_metadata', command: cmdKey };
    }

    if (cmdMeta.admin) {
      const authorized = platform === 'discord'
        ? isAdmin
        : channel === getAdminChannelId();

      if (!authorized) {
        logger.info(`Unauthorized admin cmd attempt: ${cmdKey} by ${userName} in ${channel} (platform: ${platform})`);

        if (cmdKey === 'flush') {
          sendMessage('🚫 That\'s an admin-only command! But you can use `flushvote` to start a democratic vote to clear the queue. 🗳️', channel);
          AIHandler.setUserContext(userName, 'flushvote', 'flush is admin-only, suggested flushvote', null, getAIContextScope(platform, channel));
        } else if (cmdKey === 'next') {
          sendMessage('🚫 That\'s an admin-only command! But you can use `gong` to vote for skipping the current track. 🔔', channel);
          AIHandler.setUserContext(userName, 'gong', 'next is admin-only, suggested gong', null, getAIContextScope(platform, channel));
        } else if (cmdKey === 'play') {
          const trackMatch = rawTerm.match(/(?:track\s*)?(\d+)/i) || args.find(arg => /^\d+$/.test(arg));
          const trackNum = trackMatch ? (Array.isArray(trackMatch) ? trackMatch[1] : trackMatch) : null;

          if (trackNum) {
            sendMessage(`🚫 That's an admin-only command! But you can use \`vote ${trackNum}\` to vote for that track to play sooner. 🗳️`, channel);
            AIHandler.setUserContext(userName, `vote ${trackNum}`, `play track ${trackNum} is admin-only, suggested vote`, null, getAIContextScope(platform, channel));
          } else {
            sendMessage('🚫 That\'s an admin-only command! But you can use `vote <track#>` to vote for a queued track. 🗳️', channel);
          }
        } else {
          sendMessage('🚫 Nice try! That\'s an admin-only command. This incident will be reported to... well, nobody cares. 😏', channel);
        }
        return { handled: true, executed: false, authorized: false, command: cmdKey, reason: 'unauthorized' };
      }
    }

    const normalizedUser = normalizeUser(userName);
    if (userIsBlacklisted(normalizedUser)) {
      logger.info(`Blocked command from blacklisted user: ${userName}`);
      sendMessage('🚫 You are blacklisted and cannot use this bot.', channel);
      return { handled: true, executed: false, authorized: true, command: cmdKey, reason: 'blacklisted' };
    }

    try {
      const handlerArgs = args.slice(1);
      const legacyInput = [rawTerm, ...handlerArgs];
      const result = cmdMeta.fn(legacyInput, channel, `<@${normalizedUser}>`);

      if (result && typeof result.then === 'function') {
        await result;
      }
      return { handled: true, executed: true, authorized: true, command: cmdKey };
    } catch (err) {
      logger.error(`Error running command ${cmdKey}: ${err.stack || err.message || err}`);
      try {
        sendMessage('🚨 Whoops! Something went wrong handling your command. The error has been logged! 📋', channel);
      } catch (sendErr) {
        // Best effort only.
      }
      return { handled: true, executed: false, authorized: true, command: cmdKey, reason: 'handler_error', error: err.message };
    }
  }

  return {
    routeCommand,
    processInput,
    handleNaturalLanguage,
    aliasMap,
  };
}

module.exports = {
  createCommandRouter,
  buildAliasMap,
  cleanCommandText,
};
