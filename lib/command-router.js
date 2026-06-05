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

  function isKnownCommand(command) {
    return commandRegistry.has(command) || aliasMap.has(command);
  }

  function resolveCommand(command) {
    return commandRegistry.has(command) ? command : aliasMap.get(command);
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

  function buildMultiAddMessage(result, query, actionMessage = 'Added') {
    let msg = `🎵 ${actionMessage} ${result.added} tracks`;
    if (result.themeCount > 0) {
      const defaultTheme = config.get('defaultTheme') || '';
      msg += ` (${result.mainCount} "${query}" + ${result.themeCount} "${defaultTheme}")`;
    } else {
      msg += ` for "${query}"`;
    }
    msg += ' 🎉';

    if (result.skipped && result.skipped.length > 0) {
      const skippedList = result.skipped.slice(0, 5).map(track => `*${track.name}*`).join(', ');
      const moreText = result.skipped.length > 5 ? ` and ${result.skipped.length - 5} more` : '';
      msg += `\n⚠️ Skipped ${result.skipped.length} blacklisted track(s): ${skippedList}${moreText}`;
    }

    return msg;
  }

  async function queueAITrackBatch(parsed, args, cleanText, channel, platform, actionMessage = null) {
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
        sendMessage(`📝 Note: Limited to ${maxTracks} tracks in this channel. Use admin channel for larger requests.`, channel);
      }
    }

    const query = finalArgs.slice(0, -1).join(' ');
    const result = await musicHelper.searchAndQueue(sonos, query, maybeCount, {
      useTheme: isAdminChannel
    });

    if (!result.added) {
      sendMessage(`🤷 I couldn't find tracks for "${query}". Try a different search!`, channel);
      return { handled: true, args: finalArgs };
    }

    const resolvedActionMessage = actionMessage || (result.wasPlaying ? 'Added' : 'Started fresh with');
    sendMessage(buildMultiAddMessage(result, query, resolvedActionMessage), channel);
    notifyRegionErrors(result, channel);
    return { handled: true, args: finalArgs };
  }

  async function handleNaturalLanguage(text, channel, userName, platform = 'slack', isAdmin = false) {
    logger.info(`>>> handleNaturalLanguage called with: "${text}"`);
    updateContext(platform, channel, isAdmin);

    const cleanText = text.replace(/<@[^>]+>/g, '').trim();
    logger.info(`>>> cleanText after stripping mention: "${cleanText}"`);

    const firstWord = cleanText.split(/\s+/)[0].toLowerCase();
    const restOfText = cleanText.slice(firstWord.length).trim().toLowerCase();

    if (isKnownCommand(firstWord)) {
      const cmdKey = resolveCommand(firstWord);
      const cmdMeta = commandRegistry.get(cmdKey);
      if (cmdMeta && cmdMeta.admin) {
        logger.info(`>>> Skipping AI - admin command "${firstWord}" should be processed directly`);
        return processInput(cleanText, channel, userName, platform, isAdmin);
      }
    }

    const naturalLangPattern = /\b(some|couple|few|several|good|best|nice|great|top|tunes|songs|music|tracks|for a|for the)\b/i;
    const looksLikeNaturalLang = naturalLangPattern.test(restOfText);
    logger.info(`>>> firstWord="${firstWord}", looksLikeNaturalLang=${looksLikeNaturalLang}`);

    if (isKnownCommand(firstWord) && !looksLikeNaturalLang) {
      logger.info(`>>> Skipping AI - known command "${firstWord}" without natural language`);
      return processInput(cleanText, channel, userName, platform, isAdmin);
    }

    if (isKnownCommand(firstWord)) {
      logger.info(`>>> Proceeding to AI despite command "${firstWord}" because it looks like natural language`);
    }

    if (!AIHandler.isAIEnabled()) {
      logger.debug('AI disabled, falling back to standard processing');
      sendMessage('🤔 I didn\'t understand that. Try: `add <song>`, `bestof <artist>`, `gong`, `current`, or `help`', channel);
      await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, reason: 'ai_disabled' });
      return;
    }

    try {
      let parsed = null;
      const ctx = AIHandler.getUserContext(userName);
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
              summary: 'You got it! Playing those tunes now! 🎵'
            };
          } else if (ctx.lastSuggestion) {
            logger.info(`User "${userName}" confirmed last suggestion: ${ctx.lastSuggestion}`);
            const parts = ctx.lastSuggestion.trim().split(/\s+/);
            parsed = {
              command: parts[0] || 'add',
              args: parts.slice(1),
              confidence: 0.95,
              reasoning: 'User confirmed previous suggestion',
              summary: 'You got it! Playing those tunes now! 🎵'
            };
          }

          if (parsed) {
            AIHandler.clearUserContext(userName);
          }
        }
      }

      if (!parsed) {
        parsed = await AIHandler.parseNaturalLanguage(cleanText, userName);

        if (!parsed) {
          logger.warn(`AI parsing returned null for: "${cleanText}"`);
          sendMessage('🤖 Sorry, I couldn\'t understand that. Try `help` to see available commands!', channel);
          await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, reasoning: 'none', reason: 'parse_null' });
          return;
        }

        if (parsed.command === 'chat' && parsed.response) {
          logger.info(`AI chat response: "${cleanText}" → "${parsed.response}"`);
          sendMessage(parsed.response, channel);

          if (parsed.suggestedAction && parsed.suggestedAction.command) {
            const suggestion = `${parsed.suggestedAction.command} ${parsed.suggestedAction.args.join(' ')}`;
            const description = parsed.suggestedAction.description || suggestion;
            AIHandler.setUserContext(userName, suggestion, `offered to play ${description}`, parsed.suggestedAction);
            logger.info(`Chat suggestion saved for ${userName}: "${suggestion}" (${description})`);
          }
          return;
        }

        if (parsed.confidence < 0.5) {
          logger.info(`Low confidence (${parsed.confidence}) for: "${cleanText}" → ${parsed.command}`);
          sendMessage(`🤔 Not sure I understood. Did you mean: \`${parsed.command} ${parsed.args.join(' ')}\`?\nTry \`help\` for available commands.`, channel);
          await writeAIUnparsed({ ts: new Date().toISOString(), user: userName, platform, channel, text: cleanText, parsed, reasoning: parsed.reasoning, reason: 'low_confidence' });
          return;
        }

        logger.info(`✨ AI parsed: "${cleanText}" → ${parsed.command} [${parsed.args.join(', ')}] (${(parsed.confidence * 100).toFixed(0)}%)`);
        if (parsed.summary) {
          sendMessage(parsed.summary, channel);
        }
      } else {
        sendMessage(parsed.summary, channel);
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

      try {
        const batchResult = await queueAITrackBatch(parsed, finalArgs, cleanText, channel, platform);
        if (batchResult.handled) {
          return;
        }
        finalArgs = batchResult.args;
      } catch (err) {
        logger.error('Multi-add failed: ' + err.message);
        sendMessage('❌ Sorry, failed to add multiple tracks.', channel);
        return;
      }

      const commandText = finalArgs.length > 0
        ? `${parsed.command} ${finalArgs.join(' ')}`
        : parsed.command;
      await processInput(commandText, channel, userName, platform, isAdmin);

      if (parsed.followUp && parsed.followUp.command) {
        logger.info(`>>> Processing followUp command: ${parsed.followUp.command} [${(parsed.followUp.args || []).join(', ')}]`);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const followUpParsed = {
          command: parsed.followUp.command,
          args: parsed.followUp.args || [],
          confidence: parsed.confidence,
          reasoning: parsed.followUp.reasoning || 'followUp command',
          summary: null
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
                sendMessage(`📝 Note: Limited to ${maxTracks} tracks in this channel. Use admin channel for larger requests.`, channel);
              }
            }

            const defaultTheme = config.get('defaultTheme') || 'popular hits';
            const query = followUpArgs.slice(0, -1).join(' ') || defaultTheme;

            try {
              const result = await musicHelper.searchAndQueue(sonos, query, maybeCount, {
                useTheme: isAdminChannel
              });

              if (!result.added) {
                sendMessage(`🤷 Couldn't find tracks for "${query}" in followUp.`, channel);
                return;
              }

              notifyRegionErrors(result, channel);
              sendMessage(buildMultiAddMessage(result, query, 'Added'), channel);
              return;
            } catch (err) {
              logger.error('FollowUp multi-add failed: ' + err.message);
              sendMessage('❌ Failed to add tracks in followUp.', channel);
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
      sendMessage('❌ Oops, something went wrong processing your request. Try using a command directly!', channel);
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
      return;
    }

    text = text.trim();
    text = text.replace(/^<@[^>]+>\s*/, '').trim();

    const args = parseArgs(text);
    if (args.length === 0) return;

    const rawTerm = args[0].toLowerCase();
    const cmdKey = resolveCommand(rawTerm);

    if (!cmdKey) {
      logger.info(`Unknown command "${rawTerm}" from ${userName} in ${channel} [${platform}]`);
      return;
    }

    const cmdMeta = commandRegistry.get(cmdKey);
    if (!cmdMeta) {
      logger.error(`Command metadata missing for ${cmdKey}`);
      return;
    }

    if (cmdMeta.admin) {
      const authorized = platform === 'discord'
        ? isAdmin
        : channel === getAdminChannelId();

      if (!authorized) {
        logger.info(`Unauthorized admin cmd attempt: ${cmdKey} by ${userName} in ${channel} (platform: ${platform})`);

        if (cmdKey === 'flush') {
          sendMessage('🚫 That\'s an admin-only command! But you can use `flushvote` to start a democratic vote to clear the queue. 🗳️', channel);
          AIHandler.setUserContext(userName, 'flushvote', 'flush is admin-only, suggested flushvote');
        } else if (cmdKey === 'next') {
          sendMessage('🚫 That\'s an admin-only command! But you can use `gong` to vote for skipping the current track. 🔔', channel);
          AIHandler.setUserContext(userName, 'gong', 'next is admin-only, suggested gong');
        } else if (cmdKey === 'play') {
          const trackMatch = rawTerm.match(/(?:track\s*)?(\d+)/i) || args.find(arg => /^\d+$/.test(arg));
          const trackNum = trackMatch ? (Array.isArray(trackMatch) ? trackMatch[1] : trackMatch) : null;

          if (trackNum) {
            sendMessage(`🚫 That's an admin-only command! But you can use \`vote ${trackNum}\` to vote for that track to play sooner. 🗳️`, channel);
            AIHandler.setUserContext(userName, `vote ${trackNum}`, `play track ${trackNum} is admin-only, suggested vote`);
          } else {
            sendMessage('🚫 That\'s an admin-only command! But you can use `vote <track#>` to vote for a queued track. 🗳️', channel);
          }
        } else {
          sendMessage('🚫 Nice try! That\'s an admin-only command. This incident will be reported to... well, nobody cares. 😏', channel);
        }
        return;
      }
    }

    const normalizedUser = normalizeUser(userName);
    if (userIsBlacklisted(normalizedUser)) {
      logger.info(`Blocked command from blacklisted user: ${userName}`);
      sendMessage('🚫 You are blacklisted and cannot use this bot.', channel);
      return;
    }

    try {
      const handlerArgs = args.slice(1);
      const legacyInput = [rawTerm, ...handlerArgs];
      const result = cmdMeta.fn(legacyInput, channel, `<@${normalizedUser}>`);

      if (result && typeof result.then === 'function') {
        await result;
      }
    } catch (err) {
      logger.error(`Error running command ${cmdKey}: ${err.stack || err.message || err}`);
      try {
        sendMessage('🚨 Whoops! Something went wrong handling your command. The error has been logged! 📋', channel);
      } catch (sendErr) {
        // Best effort only.
      }
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
