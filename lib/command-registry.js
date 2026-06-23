/**
 * Builds the SlackONOS command registry.
 *
 * Command implementations are injected so the registry stays declarative and
 * does not own application state.
 */

function createCommandRegistry(deps) {
  const {
    addHandlers,
    commandHandlers,
    voting,
    currentTrack,
    showSource,
    gongplay,
    status,
    help,
    bestof,
    debug,
    telemetryStatus,
    setCrossfade,
    setconfig,
    blacklist,
    trackblacklist,
    tts,
    moveTrackAdmin,
    stats,
    configdump,
    aiUnparsed,
    listOpenAIModels,
    featurerequest,
    addToSpotifyPlaylist,
    diagnostics,
  } = deps;

  return new Map([
    // Common commands
    ['add', { fn: addHandlers.add, admin: false }],
    ['addalbum', { fn: addHandlers.addalbum, admin: false }],
    ['addplaylist', { fn: addHandlers.addplaylist, admin: false }],
    ['search', { fn: commandHandlers.search, admin: false }],
    ['searchalbum', { fn: (args, ch, u) => commandHandlers.searchalbum(args, ch, u), admin: false }],
    ['searchplaylist', { fn: commandHandlers.searchplaylist, admin: false }],
    ['current', { fn: (args, ch) => currentTrack(ch), admin: false, aliases: ['wtf'] }],
    ['source', { fn: (args, ch) => showSource(ch), admin: false }],
    ['gong', { fn: (args, ch, u) => voting.gong(ch, u, () => gongplay('play', ch)), admin: false, aliases: ['dong', ':gong:', ':gun:'] }],
    ['gongcheck', { fn: (args, ch) => voting.gongcheck(ch), admin: false }],
    ['voteimmune', { fn: (args, ch, u) => voting.voteImmune(args, ch, u), admin: false }],
    ['vote', { fn: (args, ch, u) => voting.vote(args, ch, u), admin: false, aliases: [':star:'] }],
    ['voteimmunecheck', { fn: (args, ch) => voting.voteImmunecheck(ch), admin: false }],
    ['votecheck', { fn: (args, ch) => voting.votecheck(ch), admin: false }],
    ['list', { fn: (args, ch) => commandHandlers.listQueue(args, ch), admin: false, aliases: ['ls', 'playlist'] }],
    ['listall', { fn: (args, ch) => commandHandlers.showQueue(ch), admin: false }],
    ['upnext', { fn: (args, ch) => commandHandlers.upNext(ch), admin: false }],
    ['volume', { fn: (args, ch) => commandHandlers.getVolume(ch), admin: false }],
    ['flushvote', { fn: (args, ch, u) => voting.flushvote(ch, u), admin: false }],
    ['size', { fn: (args, ch) => commandHandlers.countQueue(ch), admin: false, aliases: ['count', 'count(list)'] }],
    ['status', { fn: (args, ch) => status(ch), admin: false }],
    ['help', { fn: help, admin: false }],
    ['bestof', { fn: bestof, admin: false }],
    ['append', { fn: addHandlers.append, admin: false }],

    // Admin-only commands
    ['debug', { fn: (args, ch, u) => debug(ch, u), admin: true }],
    ['telemetry', { fn: (args, ch) => telemetryStatus(ch), admin: true }],
    ['next', { fn: (args, ch, u) => commandHandlers.nextTrack(ch, u), admin: true }],
    ['stop', { fn: commandHandlers.stop, admin: true }],
    ['flush', { fn: commandHandlers.flush, admin: true }],
    ['play', { fn: commandHandlers.play, admin: true }],
    ['pause', { fn: commandHandlers.pause, admin: true }],
    ['resume', { fn: commandHandlers.resume, admin: true, aliases: ['playpause'] }],
    ['previous', { fn: commandHandlers.previous, admin: true }],
    ['shuffle', { fn: commandHandlers.shuffle, admin: true }],
    ['normal', { fn: commandHandlers.normal, admin: true }],
    ['setvolume', { fn: commandHandlers.setVolume, admin: true }],
    ['setcrossfade', { fn: setCrossfade, admin: true, aliases: ['crossfade'] }],
    ['setconfig', { fn: setconfig, admin: true, aliases: ['getconfig', 'config'] }],
    ['blacklist', { fn: blacklist, admin: true }],
    ['trackblacklist', { fn: trackblacklist, admin: true, aliases: ['songblacklist', 'bantrack', 'bansong'] }],
    ['remove', { fn: (args, ch) => commandHandlers.removeTrack(args, ch), admin: true }],
    ['thanos', { fn: (args, ch) => commandHandlers.purgeHalfQueue(args, ch), admin: true, aliases: ['snap'] }],
    ['listimmune', { fn: (args, ch) => voting.listImmune(ch), admin: true }],
    ['tts', { fn: (args, ch) => tts(args, ch), admin: true, aliases: ['say'] }],
    ['move', { fn: moveTrackAdmin, admin: true, aliases: ['mv'] }],
    ['stats', { fn: stats, admin: true }],
    ['configdump', { fn: configdump, admin: true, aliases: ['cfgdump', 'confdump'] }],
    ['aiunparsed', { fn: aiUnparsed, admin: true, aliases: ['aiun', 'aiunknown'] }],
    ['aimodels', { fn: (args, ch, u) => listOpenAIModels(args, ch, u), admin: true, aliases: ['openaimodels', 'models'] }],
    ['featurerequest', { fn: featurerequest, admin: false, aliases: ['feuturerequest'] }],
    ['fr', { fn: featurerequest, admin: false }],
    ['test', { fn: (args, ch) => addToSpotifyPlaylist(args, ch), admin: true }],
    ['diagnostics', { fn: diagnostics, admin: true, aliases: ['diag', 'checksource'] }]
  ]);
}

module.exports = {
  createCommandRegistry,
};
