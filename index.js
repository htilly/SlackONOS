const fs = require('fs');
const os = require('os');
const mp3Duration = require('mp3-duration');
const path = require('path');
const GTTS = require('gtts'); // Import the gtts library
const config = require('nconf')
const winston = require('winston')
const Spotify = require('./spotify')
const utils = require('./utils')
const process = require('process')
const parseString = require('xml2js').parseString
const http = require('http')
const gongMessage = fs.readFileSync('gong.txt', 'utf8').split('\n').filter(Boolean);
const voteMessage = fs.readFileSync('vote.txt', 'utf8').split('\n').filter(Boolean);
const ttsMessage = fs.readFileSync('tts.txt', 'utf8').split('\n').filter(Boolean);
const buildNumber = Number(fs.readFileSync('build.txt', 'utf8').split('\n').filter(Boolean)[0]);
const { execSync } = require('child_process');
const gongBannedTracks = {};
const SLACK_API_URL_LIST = 'https://slack.com/api/conversations.list';
const userActionsFile = path.join(__dirname, 'config/userActions.json');



config.argv()
  .env()
  .file({
    file: 'config/config.json'
  })
  .defaults({
    adminChannel: 'music-admin',
    standardChannel: 'music',
    gongLimit: 3,
    voteImmuneLimit: 3,
    voteLimit: 3,
    flushVoteLimit: 6,
    maxVolume: '75',
    market: 'US',
    blacklist: [],
    searchLimit: 7,
    webPort: 8181,
    logLevel: 'info'
  })

// const adminChannel = config.get('adminChannel');
const gongLimit = config.get('gongLimit')
const voteImmuneLimit = config.get('voteImmuneLimit')
const voteLimit = config.get('voteLimit')
const flushVoteLimit = config.get('flushVoteLimit')
const token = config.get('token')
const maxVolume = config.get('maxVolume')
const market = config.get('market')
const voteTimeLimitMinutes = config.get('voteTimeLimitMinutes')
const clientId = config.get('spotifyClientId')
const clientSecret = config.get('spotifyClientSecret')
const searchLimit = config.get('searchLimit')
const logLevel = config.get('logLevel')
const sonosIp = config.get('sonos')
const webPort = config.get('webPort')
let ipAddress = config.get('ipAddress')





let blacklist = config.get('blacklist')
if (!Array.isArray(blacklist)) {
  blacklist = blacklist.replace(/\s*(,|^|$)\s*/g, '$1').split(/\s*,\s*/)
}

/* Initialize Logger */
const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamp
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // Add timestamp to console logs
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        })
      )
    })
  ]
});

/* Initialize Sonos */
const SONOS = require('sonos')
const Sonos = SONOS.Sonos
const sonos = new Sonos(sonosIp)

if (market !== 'US') {
  sonos.setSpotifyRegion(SONOS.SpotifyRegion.EU)
  logger.info('Setting Spotify region to EU...')
  logger.info('Market is: ' + market)
}

/* Initialize Spotify instance */
const spotify = Spotify({
  clientId: clientId,
  clientSecret: clientSecret,
  market: market,
  logger: logger
})

let gongCounter = 0
let gongScore = {}
const gongLimitPerUser = 1

let voteImmuneCounter = 0
const voteImmuneLimitPerUser = 1
let voteImmuneScore = {}
let gongBanned = false
let gongTrack = '' // What track was a GONG called on
let voteCounter = 0
const voteLimitPerUser = 4
const flushVoteLimitPerUser = 1
let voteScore = {}
let flushVoteScore = {}

if (!token) {
  throw new Error('SLACK_API_TOKEN is not set');
}

const { RTMClient } = require('@slack/rtm-api');
const { WebClient } = require('@slack/web-api');
const rtm = new RTMClient(token, {
  logLevel: 'error',
  dataStore: false,
  autoReconnect: true,
  autoMark: true
});
const web = new WebClient(token);

let botUserId;

(async () => {
  try {
    // Fetch the bot's user ID
    const authResponse = await web.auth.test();
    botUserId = authResponse.user_id;

    await rtm.start();
  } catch (error) {
    logger.error(`Error starting RTMClient: ${error}`);
  }
})();

rtm.on('message', (event) => {
  // Ignore messages from the bot itself
  if (event.user === botUserId) {
    return;
  }

  const { type, ts, text, channel, user } = event;

  logger.info(event.text);
  logger.info(event.channel);
  logger.info(event.user);

  logger.info(`Received: ${type} ${channel} <@${user}> ${ts} "${text}"`);

  if (type !== 'message' || !text || !channel) {
    const errors = [
      type !== 'message' ? `unexpected type ${type}.` : null,
      !text ? 'text was undefined.' : null,
      !channel ? 'channel was undefined.' : null
    ].filter(Boolean).join(' ');

    logger.error(`Could not respond. ${errors}`);
    return false;
  }

  processInput(text, channel, `<@${user}>`);
});

rtm.on('error', (error) => {
  logger.error(`RTMClient error: ${error}`);
});


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// Proper delay function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to fetch the channel IDs
async function _lookupChannelID() {
  let allChannels = [];
  let nextCursor;
  let retryAfter = 0;
  let backoff = 1; // Exponential backoff starts at 1 second

  try {
    do {
      // Wait if rate limited
      if (retryAfter > 0) {
        logger.warn(`Rate limit hit! Retrying after ${retryAfter} seconds...`);
        logger.info(`Wait start: ${new Date().toISOString()}`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        retryAfter = 0; // Reset retryAfter
      }

      // Fetch channels
      const url = `${SLACK_API_URL_LIST}?limit=1000&types=public_channel,private_channel${nextCursor ? `&cursor=${nextCursor}` : ''}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info(`Response status for fetching channels: ${response.status}`);

      if (response.status === 429) {
        retryAfter = parseInt(response.headers.get('retry-after')) || backoff;
        backoff = Math.min(backoff * 2, 60); // Exponential backoff up to 60s
        continue;
      }

      const data = await response.json();
      if (!data.ok) throw new Error(`Slack API Error: ${data.error}`);

      // Extract and add channels
      if (data.channels) allChannels = allChannels.concat(data.channels);

      nextCursor = data.response_metadata?.next_cursor;

      // Reset backoff after successful response
      backoff = 1;

    } while (nextCursor);

    logger.info('Fetched channels: ' + allChannels.map(channel => channel.name).join(', '));

    // Fetch Admin and Standard channel IDs
    const adminChannelName = config.get('adminChannel').replace('#', '');
    const standardChannelName = config.get('standardChannel').replace('#', '');

    logger.info('Admin channel (in config): ' + adminChannelName);
    logger.info('Standard channel (in config): ' + standardChannelName);

    const adminChannelInfo = allChannels.find(channel => channel.name === adminChannelName);
    if (!adminChannelInfo) throw new Error(`Admin channel "${adminChannelName}" not found`);

    const standardChannelInfo = allChannels.find(channel => channel.name === standardChannelName);
    if (!standardChannelInfo) throw new Error(`Standard channel "${standardChannelName}" not found`);

    // Set the global variables
    global.adminChannel = adminChannelInfo.id;
    global.standardChannel = standardChannelInfo.id;

    logger.info('Admin channelID: ' + global.adminChannel);
    logger.info('Standard channelID: ' + global.standardChannel);

  } catch (error) {
    logger.error(`Error fetching channels: ${error.message}`);
  }
}

// Call the function to lookup channel IDs
_lookupChannelID();


// TEST CODE: Force Slack API Rate Limit
//async function testRateLimit() {
//  const requests = 500; // Adjust the number of simultaneous requests
//
// logger.info(`Starting ${requests} parallel API calls to test rate limit...`);
//
//  const promises = [];
//  for (let i = 0; i < requests; i++) {
//    promises.push(_lookupChannelID());
//  }

//  await Promise.all(promises);
//  logger.info('Finished parallel API calls.');
//}

// Run the rate limit test
//(async () => {
//  logger.info('Starting API rate limit test...');
//  await testRateLimit();
//  logger.info('Rate limit test completed.');
//})();



function processInput(text, channel, userName) {
  var input = text.split(' ')
  var term = input[0].toLowerCase()
  var matched = true
  logger.info('term: ' + term)

  switch (term) {
    case 'add':
      _add(input, channel, userName)
      break
    case 'addalbum':
      _addalbum(input, channel, userName)
      break
    case 'bestof':
      _bestof(input, channel, userName)
      break
    case 'append':
      _append(input, channel, userName)
      break
    case 'searchplaylist':
      _searchplaylist(input, channel, userName)
      break
    case 'searchalbum':
      _searchalbum(input, channel)
      break
    case 'addplaylist':
      _addplaylist(input, channel, userName)
      break
    case 'search':
      _search(input, channel, userName)
      break
    case 'current':
    case 'wtf':
      _currentTrack(channel)
      break
    case 'dong':
    case ':gong:':
    case ':gun:':
    case 'gong':
      _gong(channel, userName)
      break
    case 'gongcheck':
      _gongcheck(channel, userName)
      break
    case 'voteimmune':
      _voteImmune(input, channel, userName)
      break
    case 'vote':
    case ':star:':
      _vote(input, channel, userName)
      break
    case 'voteimmunecheck':
      _voteImmunecheck(channel, userName)
      break
    case 'votecheck':
      _votecheck(channel, userName)
      break
    case 'list':
    case 'ls':
    case 'playlist':
      _showQueue(channel)
      break
    case 'upnext':
      _upNext(channel)
      break
    case 'volume':
      _getVolume(channel)
      break
    case 'flushvote':
      _flushvote(channel, userName)
      break
    case 'size':
    case 'count':
    case 'count(list)':
      _countQueue(channel)
      break
    case 'status':
      _status(channel)
      break
    case 'help':
      _help(input, channel)
      break
    default:
      matched = false
      break
    case 'flush':
      _flush(input, channel, userName)
      break
  }

  if (!matched && channel === global.adminChannel) {
    switch (term) {
      case 'debug':
        _debug(channel, userName)
        break
      case 'next':
        _nextTrack(channel, userName)
        break
      case 'stop':
        _stop(input, channel, userName)
        break
      case 'flush':
        _flush(input, channel, userName)
        break
      case 'play':
        _play(input, channel, userName)
        break
      case 'pause':
        _pause(input, channel, userName)
        break
      case 'playpause':
      case 'resume':
        _resume(input, channel, userName)
        break
      case 'previous':
        _previous(input, channel, userName)
        break
      case 'shuffle':
        _shuffle(input, channel, userName)
        break
      case 'normal':
        _normal(input, channel, userName)
        break
      case 'setvolume':
        _setVolume(input, channel, userName)
        break
      case 'blacklist':
        _blacklist(input, channel, userName)
        break
      case 'test':
        _addToSpotifyPlaylist(input, channel)
        break
      case 'remove':
        _removeTrack(input, channel)
        break
      case 'thanos':
      case 'snap':
        _purgeHalfQueue(input, channel)
        break
      case 'listimmune':
        _listImmune(channel)
        break
      case 'tts':
      case 'say':
        _tts(input, channel)
        break
      case 'move':
      case 'mv':
        _moveTrackAdmin(input, channel, userName)
        break
      case 'stats':
        _stats(input, channel, userName)
        break
      default:
    }
  }
}




function _slackMessage(message, id) {
  if (rtm.connected) {
    rtm.sendMessage(message, id)
  } else {
    logger.info(message)
  }
}

const userCache = {};

async function _checkUser(userId) {
  try {
    // Clean the userId if wrapped in <@...>
    userId = userId.replace(/[<@>]/g, "");

    // Check if user info is already in cache
    if (userCache[userId]) {
      return userCache[userId];
    }

    // Fetch user info from Slack API
    const result = await web.users.info({ user: userId });
    if (result.ok && result.user) {
      userCache[userId] = result.user.name; // Cache the user info
      return result.user.name;
    } else {
      logger.error('User not found: ' + userId);
      return null;
    }
  } catch (error) {
    if (error.data && error.data.error === 'user_not_found') {
      logger.error('User not found: ' + userId);
    } else {
      logger.error('Error fetching user info: ' + error);
    }
    return null;
  }
}




function _getVolume(channel) {
  sonos.getVolume().then(vol => {
    logger.info('The volume is: ' + vol);
    _slackMessage('Currently blasting at ' + vol + ' dB _(ddB)_', channel);
  }).catch(err => {
    logger.error('Error occurred: ' + err);
  });
}

function _setVolume(input, channel, userName) {
  _logUserAction(userName, 'setVolume');
  if (channel !== global.adminChannel) {
    return;
  }

  const vol = Number(input[1]);

  if (isNaN(vol)) {
    _slackMessage('Nope.', channel);
    return;
  }

  logger.info('Volume is: ' + vol);
  if (vol > maxVolume) {
    _slackMessage("That's a bit extreme, " + userName + '... lower please.', channel);
    return;
  }

  setTimeout(() => {
    sonos.setVolume(vol).then(() => {
      logger.info('The volume is set to: ' + vol);
      _getVolume(channel);
    }).catch(err => {
      logger.error('Error occurred while setting volume: ' + err);
    });
  }, 1000);
}


function _countQueue(channel, cb) {
  sonos.getQueue().then(result => {
    if (cb) {
      return cb(result.total)
    }
    _slackMessage(`${result.total} songs in the queue`, channel)
  }).catch(err => {
    logger.error(err)
    if (cb) {
      return cb(null, err)
    }
    _slackMessage('Error getting queue length', channel)
  })
}

async function _showQueue(channel) {
  try {
    const result = await sonos.getQueue();
    //   logger.info('Current queue: ' + JSON.stringify(result, null, 2))
    _status(channel, function (state) {
      logger.info('_showQueue, got state = ' + state)
    });
    _currentTrack(channel, function (err, track) {
      if (!result) {
        logger.debug(result);
        _slackMessage('Seems like the queue is empty... Have you tried adding a song?!', channel);
      }
      if (err) {
        logger.error(err);
      }
      var message = 'Total tracks in queue: ' + result.total + '\n====================\n';
      logger.info('Total tracks in queue: ' + result.total);
      const tracks = [];

      result.items.map(
        function (item, i) {
          let trackTitle = item.title;
          if (_isTrackGongBanned(item.title)) {
            tracks.push(':lock: ' + '_#' + i + '_ ' + trackTitle + ' by ' + item.artist);
            //          trackTitle = ':lock:' + trackTitle;
          } else if (item.title === track.title) {
            trackTitle = '*' + trackTitle + '*';
          } else {
            trackTitle = '_' + trackTitle + '_';
          }

          if (item.title === track.title) {
            tracks.push(':notes: ' + '_#' + i + '_ ' + trackTitle + ' by ' + item.artist);
          } else {
            tracks.push('>_#' + i + '_ ' + trackTitle + ' by ' + item.artist);
          }
        }
      );
      for (var i in tracks) {
        message += tracks[i] + '\n';
        if (i > 0 && Math.floor(i % 100) === 0) {
          _slackMessage(message, channel);
          message = '';
        }
      }
      if (message) {
        _slackMessage(message, channel);
      }
    });
  } catch (err) {
    logger.error('Error fetching queue: ' + err);
  }
}

function _upNext(channel) {
  sonos.getQueue().then(result => {
    //    logger.debug('Current queue: ' + JSON.stringify(result, null, 2));

    _currentTrack(channel, function (err, track) {
      if (!result || !result.items || result.items.length === 0) {
        logger.debug('Queue is empty or undefined');
        _slackMessage('Seems like the queue is empty... Have you tried adding a song?!', channel);
        return;
      }
      if (err) {
        logger.error('Error getting current track: ' + err);
        return;
      }
      if (!track) {
        logger.debug('Current track is undefined');
        _slackMessage('No current track is playing.', channel);
        return;
      }

      //      logger.info('Got current track: ' + JSON.stringify(track, null, 2));

      var message = 'Upcoming tracks\n====================\n';
      let tracks = [];
      let currentIndex = track.queuePosition;

      // Add current track and upcoming tracks to the tracks array
      result.items.forEach((item, i) => {
        if (i >= currentIndex && i <= currentIndex + 5) {
          tracks.push('_#' + i + '_ ' + "_" + item.title + "_" + ' by ' + item.artist);
        }
      });

      for (var i in tracks) {
        message += tracks[i] + '\n';
      }

      if (message) {
        _slackMessage(message, channel);
      }
    });
  }).catch(err => {
    logger.error('Error fetching queue: ' + err);
  });
}


let voteTimer = null;
const voteTimeLimit = voteTimeLimitMinutes * 60 * 1000; // Convert minutes to milliseconds





function _flushvote(channel, userName) {
  _logUserAction(userName, 'flushvote');
  logger.info('_flushvote...');

  if (!(userName in flushVoteScore)) {
    flushVoteScore[userName] = 0;
  }

  if (flushVoteScore[userName] >= flushVoteLimitPerUser) {
    _slackMessage('Are you trying to cheat, ' + userName + '? DENIED!', channel);
  } else {
    flushVoteScore[userName] = flushVoteScore[userName] + 1;
    voteCounter++;
    logger.info('1voteCounter: ' + voteCounter);
    logger.info('1voteTimer: ' + voteTimer);
    if (voteCounter === 1) {
      // Start the timer on the first vote
      voteTimer = setTimeout(() => {
        voteCounter = 0;
        flushVoteScore = {};
        _slackMessage('Voting period ended.', channel);
        logger.info('Voting period ended... Guess the playlist isn´t that bad after all!!');
      }, voteTimeLimit);
      _slackMessage("Voting period started for a flush of the queue... You have " + voteTimeLimitMinutes + " minutes to gather " + flushVoteLimit + " votes !!", channel);
      logger.info('Voting period started!!');
      logger.info('3voteCounter: ' + voteCounter);
      logger.info('3voteTimer: ' + voteTimer);
    }

    _slackMessage('This is VOTE ' + "*" + voteCounter + "*" + '/' + flushVoteLimit + ' for a full flush of the playlist!!', channel);

    if (voteCounter >= flushVoteLimit) {
      clearTimeout(voteTimer); // Clear the timer if the vote limit is reached
      _slackMessage('The votes have spoken! Flushing the queue...:toilet:', channel);
      try {
        sonos.flush();
      } catch (error) {
        logger.error('Error flushing the queue: ' + error);
      }
      voteCounter = 0;
      flushVoteScore = {};
    }
  }
}


function _gong(channel, userName) {
  _logUserAction(userName, 'gong');
  logger.info('_gong...')
  _currentTrackTitle(channel, function (err, track) {
    if (err) {
      logger.error(err)
    }
    logger.info('_gong > track: ' + track)

    // NOTE: The gongTrack is checked in _currentTrackTitle() so we
    // need to let that go through before checking if gong is banned.
    if (_isTrackGongBanned(track)) {
      logger.info('Track is gongBanned: ' + track);
      _slackMessage('Sorry ' + userName + ', the people have voted and this track cannot be gonged...', channel)
      return
    }

    // Get message
    logger.info('gongMessage.length: ' + gongMessage.length)
    var ran = Math.floor(Math.random() * gongMessage.length)
    var randomMessage = gongMessage[ran]
    logger.info('gongMessage: ' + randomMessage)

    // Need a delay before calling the rest
    if (!(userName in gongScore)) {
      gongScore[userName] = 0
    }

    if (gongScore[userName] >= gongLimitPerUser) {
      _slackMessage('Are you trying to cheat, ' + userName + '? DENIED!', channel)
    } else {
      if (userName in voteImmuneScore) {
        _slackMessage('Having regrets, ' + userName + "? We're glad you came to your senses...", channel)
      }

      gongScore[userName] = gongScore[userName] + 1
      gongCounter++
      _slackMessage(randomMessage + ' This is GONG ' + gongCounter + '/' + gongLimit + ' for ' + "*" + track + "*", channel)
      if (gongCounter >= gongLimit) {
        _slackMessage('The music got GONGED!!', channel)
        _gongplay('play', channel)
        gongCounter = 0
        gongScore = {}
      }
    }
  })
}





function _voteImmune(input, channel, userName) {
  var voteNb = input[1];
  voteNb = Number(voteNb) + 1; // Add 1 to match the queue index
  voteNb = String(voteNb);
  logger.info('voteNb: ' + voteNb);

  sonos.getQueue().then(result => {
    logger.info('Current queue: ' + JSON.stringify(result, null, 2));
    logger.info('Finding track:' + voteNb);
    let trackFound = false;
    let voteTrackId = null;
    let voteTrackName = null;

    for (var i in result.items) {
      var queueTrack = result.items[i].id;
      queueTrack = queueTrack.split('/')[1];
      logger.info('queueTrack: ' + queueTrack);
      if (voteNb === queueTrack) {
        voteTrackId = result.items[i].id.split('/')[1];
        voteTrackName = result.items[i].title;
        logger.info('voteTrackName: ' + voteTrackName);
        trackFound = true;
        break;
      }
    }

    if (trackFound) {
      if (!(userName in voteImmuneScore)) {
        voteImmuneScore[userName] = 0;
      }

      if (voteImmuneScore[userName] >= voteImmuneLimitPerUser) {
        _slackMessage('Are you trying to cheat, ' + userName + '? DENIED!', channel);
      } else {
        if (userName in gongScore) {
          _slackMessage('Changed your mind, ' + userName + '? Well, ok then...', channel);
        }

        voteImmuneScore[userName] = voteImmuneScore[userName] + 1;
        voteImmuneCounter++;

        _slackMessage('This is VOTE ' + voteImmuneCounter + '/' + voteImmuneLimit + ' for ' + "*" + voteTrackName + "*", channel);
        if (voteImmuneCounter >= voteImmuneLimit) {
          _slackMessage('This track is now immune to GONG! (just this once)', channel);
          voteImmuneCounter = 0;
          voteImmuneScore = {};
          gongBannedTracks[voteTrackName] = true; // Mark the track as gongBanned
        }
      }
    }
  });
}

// Function to check if a track is gongBanned
function _isTrackGongBanned(trackName) {
  return gongBannedTracks[trackName] === true;
}

function _listImmune(channel) {
  const gongBannedTracksList = Object.keys(gongBannedTracks);
  if (gongBannedTracksList.length === 0) {
    _slackMessage('No tracks are currently immune.', channel);
  } else {
    const message = 'Immune Tracks:\n' + gongBannedTracksList.join('\n');
    _slackMessage(message, channel);
  }
}



// Initialize vote count object
let trackVoteCount = {};

function _vote(input, channel, userName) {
  _logUserAction(userName, 'vote');

  // Get message
  logger.info('voteMessage.length: ' + voteMessage.length)
  var ran = Math.floor(Math.random() * voteMessage.length)
  var randomMessage = voteMessage[ran]
  logger.info('voteMessage: ' + randomMessage)

  var voteNb = input[1];
  voteNb = Number(voteNb) + 1; // Add 1 to match the queue index
  voteNb = String(voteNb);
  logger.info('voteNb: ' + voteNb);

  sonos.getQueue().then(result => {
    logger.info('Current queue: ' + JSON.stringify(result, null, 2))
    logger.info('Finding track:' + voteNb);
    let trackFound = false;
    for (var i in result.items) {
      var queueTrack = result.items[i].id;
      queueTrack = queueTrack.split('/')[1];
      logger.info('queueTrack: ' + queueTrack)
      if (voteNb === queueTrack) {
        var voteTrackName = result.items[i].title;
        logger.info('voteTrackName: ' + voteTrackName);
        trackFound = true;
        break;
      }
    }
    if (trackFound) {

      if (!(userName in voteScore)) {
        voteScore[userName] = 0;
      }

      if (voteScore[userName] >= voteLimitPerUser) {
        _slackMessage('Are you trying to cheat, ' + userName + '? DENIED!', channel);
      } else {
        if (userName in gongScore) {
          _slackMessage('Changed your mind, ' + userName + '? Well, ok then...', channel);
        }

        voteScore[userName] = voteScore[userName] + 1;
        voteCounter++;

        // Update the vote count for the track
        if (!(voteNb in trackVoteCount)) {
          trackVoteCount[voteNb] = 0;
        }
        trackVoteCount[voteNb] += 1;

        // Log the vote count for the track
        logger.info('Track ' + voteTrackName + ' has received ' + trackVoteCount[voteNb] + ' votes.');

        _slackMessage('This is VOTE ' + trackVoteCount[voteNb] + '/' + voteLimit + ' for ' + "*" + voteTrackName + "*", channel);
        if (trackVoteCount[voteNb] >= voteLimit) {
          logger.info('Track ' + voteTrackName + ' has reached the vote limit.');
          _slackMessage(randomMessage, channel);

          // Reset the vote count for the track
          voteImmuneCounter = 0;
          voteImmuneScore = {};

          //Now, lets move the track so it plays next

          // Get the current track position
          sonos.currentTrack().then(track => {
            logger.info('Got current track: ' + track)
            var currentTrackPosition = track.queuePosition;
            logger.info('Current track position: ' + currentTrackPosition);

            // Get the track position in the queue
            var trackPosition = parseInt(voteNb);
            logger.info('Track position: ' + trackPosition);

            // Define the parameters
            const startingIndex = trackPosition; // Assuming trackPosition is the starting index
            const numberOfTracks = 1; // Assuming we are moving one track
            const insertBefore = currentTrackPosition + 1; // Assuming desiredPosition is where the track should be moved to
            const updateId = 0; // Leave updateId as 0

            // Move to the track position using reorderTracksInQueue
            sonos.reorderTracksInQueue(startingIndex, numberOfTracks, insertBefore, updateId).then(success => {
              logger.info('Moved track to position: ' + insertBefore);
            }).catch(err => {
              logger.error('Error occurred: ' + err);
            });
          }).catch(err => {
            logger.error('Error occurred: ' + err);
          });

        }
      }
    }
  });
}

async function _moveTrackAdmin(input, channel, userName) {
  if (channel !== global.adminChannel) {
    _slackMessage('You do not have permission to move tracks.', channel);
    return;
  }

  if (input.length < 3) {
    _slackMessage('Please provide both the track number and the desired position.', channel);
    return;
  }

  const trackNb = parseInt(input[1], 10); // Use the original input value
  const desiredPosition = parseInt(input[2], 10); // Use the original input value

  if (isNaN(trackNb) || isNaN(desiredPosition)) {
    _slackMessage('Invalid track number or desired position.', channel);
    return;
  }

  logger.info(`_moveTrackAdmin: Moving track ${trackNb} to position ${desiredPosition}`);

  try {
    const queue = await sonos.getQueue();
    logger.info('Current queue: ' + JSON.stringify(queue, null, 2));

    const track = queue.items.find(item => item.id.split('/')[1] === String(trackNb + 1)); // Adjust for 1-based index
    if (!track) {
      _slackMessage(`Track number ${trackNb} not found in the queue.`, channel);
      return;
    }

    const currentTrackPosition = parseInt(track.id.split('/')[1], 10);
    logger.info('Current track position: ' + currentTrackPosition);

    // Define the parameters
    const startingIndex = currentTrackPosition; // Current position of the track
    const numberOfTracks = 1; // Moving one track
    const insertBefore = desiredPosition + 1; // Adjust for 1-based index

    // Move the track to the desired position using reorderTracksInQueue
    await sonos.reorderTracksInQueue(startingIndex, numberOfTracks, insertBefore, 0);
    logger.info(`Moved track ${trackNb} to position ${desiredPosition}`);
    _slackMessage(`Moved track ${trackNb} to position ${desiredPosition}`, channel);
  } catch (err) {
    logger.error('Error occurred: ' + err);
    _slackMessage('Error moving track. Please try again later.', channel);
  }
}


/**
 * Checks the vote status for all tracks and sends a Slack message with the results.
 * 
 * @param {string} channel - The channel to send the message to.
 */
function _votecheck(channel) {
  logger.info('Checking vote status for all tracks:');
  sonos.getQueue().then(result => {
    const trackNames = {};
    for (var i in result.items) {
      var queueTrack = result.items[i].id.split('/')[1];
      var trackName = result.items[i].title;
      trackNames[queueTrack] = trackName;
    }

    for (const trackId in trackVoteCount) {
      if (trackVoteCount.hasOwnProperty(trackId)) {
        const voteCount = trackVoteCount[trackId];
        const trackName = trackNames[trackId] || 'Unknown Track';
        const voters = Object.keys(voteScore).filter(user => voteScore[user] > 0 && voteScore[user] < voteLimitPerUser);
        const votedBy = voters.map(user => `${user}`).join(', ');
        _slackMessage("*" + trackName + "*" + ' has received ' + voteCount + ' votes. Voted by: ' + votedBy, channel);
      }
    }
  }).catch(err => {
    logger.error('Error occurred while fetching the queue: ' + err);
  });
}



function _voteImmunecheck(channel, userName) {
  logger.info('_voteImmunecheck...')

  _currentTrackTitle(channel, function (err, track) {
    logger.info('_voteImmunecheck > track: ' + track)

    _slackMessage('VOTE is currently ' + voteImmuneCounter + '/' + voteImmuneLimit + ' for ' + track, channel)
    var voters = Object.keys(voteImmuneScore)
    if (voters.length > 0) {
      _slackMessage('Voted by ' + voters.join(','), channel)
    }
    if (err) {
      logger.error(err)
    }
  })
}

function _gongcheck(channel, userName) {
  logger.info('_gongcheck...')

  _currentTrackTitle(channel, function (err, track) {
    if (err) {
      logger.error(err)
    }
    logger.info('_gongcheck > track: ' + track)

    _slackMessage('GONG is currently ' + gongCounter + '/' + gongLimit + ' for ' + track, channel)
    var gongers = Object.keys(gongScore)
    if (gongers.length > 0) {
      _slackMessage('Gonged by ' + gongers.join(','), channel)
    }
  })
}

function _previous(input, channel, userName) {
  _logUserAction(userName, 'previous');
  if (channel !== global.adminChannel) {
    return
  }
  sonos.previous(function (err, previous) {
    logger.error(err + ' ' + previous)
  })
}

function _help(input, channel) {
  const helpTextPath = path.join(__dirname, 'helpText.txt');
  const helpTextPathAdmin = path.join(__dirname, 'helpTextAdmin.txt');
  const adminMessage = fs.readFileSync(helpTextPathAdmin, 'utf8');
  let message = fs.readFileSync(helpTextPath, 'utf8');

  if (channel === global.adminChannel) {
    message += '\n' + adminMessage;
  }
  _slackMessage(message, channel)
}

function _play(input, channel, userName, state) {
  _logUserAction(userName, 'play');
  if (channel !== global.adminChannel) {
    return
  }
  sonos.selectQueue()
  sonos.play().then(result => {
    _status(channel, state)
    logger.info('Started playing - ' + result)
  }).catch(err => {
    logger.info('Error occurred: ' + err)
  })
}

function _playInt(input, channel) {
  sonos.selectQueue()
  sonos.play().then(result => {
    logger.info('playInt started playing' + result)
  }).catch(err => {
    logger.error('Error occurred: ' + err)
  })
}

function _stop(input, channel, userName, state) {
  _logUserAction(userName, 'stop');
  if (channel !== global.adminChannel) {
    return
  }
  sonos.stop().then(result => {
    _status(channel, state)
    logger.info('Stoped playing - ' + result)
  }).catch(err => {
    logger.error('Error occurred: ' + err)
  })
}

function _pause(input, channel, state) {
  if (channel !== global.adminChannel) {
    return
  }
  sonos.pause().then(result => {
    _status(channel, state)
    logger.info('Pause playing - ' + result)
  }).catch(err => {
    logger.error('Error occurred: ' + err)
  })
}

function _resume(input, channel, userName, state) {
  _logUserAction(userName, 'resume');
  if (channel !== global.adminChannel) {
    return
  }
  sonos.play().then(result => {
    setTimeout(() => _status(channel, state), 500)
    logger.info('Resume playing - ' + result)
  }).catch(err => {
    logger.error('Error occurred: ' + err)
  })
}

function _flush(input, channel, userName) {
  _logUserAction(userName, 'flush');
  if (channel !== global.adminChannel) {
    _slackMessage('Where you supposed to type _flushvote_?', channel)
    return
  }
  sonos.flush().then(result => {
    logger.info('Flushed queue: ' + JSON.stringify(result, null, 2))
    _slackMessage('Sonos queue is clear.', channel)
  }).catch(err => {
    logger.error('Error flushing queue: ' + err)
  })
}

function _flushInt(input, channel) {
  sonos.flush().then(result => {
    logger.info('Flushed queue: ' + JSON.stringify(result, null, 2))
  }).catch(err => {
    logger.error('Error flushing queue: ' + err)
  })
}

function _shuffle(input, channel, byPassChannelValidation) {
  if (channel !== global.adminChannel && !byPassChannelValidation) {
    return
  }
  sonos.setPlayMode('SHUFFLE').then(success => {
    console.log('Changed playmode to shuffle')
    _slackMessage('Changed the playmode to shuffle....', channel)
  }).catch(err => {
    console.log('Error occurred %s', err)
  })
}

function _normal(input, channel, byPassChannelValidation) {
  if (channel !== global.adminChannel && !byPassChannelValidation) {
    return
  }
  sonos.setPlayMode('NORMAL').then(success => {
    console.log('Changed playmode to normal')
    _slackMessage('Changed the playmode to normal....', channel)
  }).catch(err => {
    console.log('Error occurred %s', err)
  })
}


async function _gongplay() {
  try {
    const mediaInfo = await sonos.avTransportService().GetMediaInfo();
    //   logger.info('Current mediaInfo: ' + JSON.stringify(mediaInfo));

    const positionInfo = await sonos.avTransportService().GetPositionInfo();
    //   logger.info('Current positionInfo: ' + JSON.stringify(positionInfo));
    logger.info('Current Position: ' + JSON.stringify(positionInfo.Track));

    //    await delay(2000); // Ensure delay is awaited

    await sonos.play('https://github.com/htilly/zenmusic/raw/master/sound/gong.mp3')
      .then(() => {
        logger.info('Playing notification...');
      })
      .catch(error => {
        console.error('Error occurred: ' + error);
      });

    const nextToPlay = positionInfo.Track + 1;
    logger.info('Next to play: ' + nextToPlay);

    await delay(4000); // Ensure delay is awaited

    try {
      await sonos.selectTrack(nextToPlay);
      logger.info('Track selected successfully.');
    } catch (error) {
      logger.info('Jumping to next track failed: ' + error);
    }

    // Add a one-second delay before playing
    //   await delay(1000);

    await sonos.play();
  } catch (error) {
    logger.error('Error in _gongplay: ' + error);
  } finally {



    await sonos.getQueue().then(result => {
      logger.info('Total tracks in queue: ' + result.total)
      let removeGong = result.total

      sonos.removeTracksFromQueue([removeGong], 1).then(success => {
        logger.info('Removed track with index: ', removeGong)
      }).catch(err => {
        logger.error('Error occurred ' + err)
      })
    })
  }

}

function _removeTrack(input, channel, byPassChannelValidation) {
  if (channel !== global.adminChannel && !byPassChannelValidation) {
    return
  }
  var trackNb = parseInt(input[1]) + 1
  sonos.removeTracksFromQueue(trackNb, 1).then(success => {
    logger.info('Removed track with index: ', trackNb)
  }).catch(err => {
    logger.error('Error occurred ' + err)
  })
  var message = 'Removed track with index: ' + input[1]
  _slackMessage(message, channel)
}

function _nextTrack(channel, byPassChannelValidation) {
  if (channel !== global.adminChannel && !byPassChannelValidation) {
    return
  }
  sonos.next().then(success => {
    logger.info('_nextTrack > Playing Netx track.. ')
  }).catch(err => {
    logger.error('Error occurred', err)
  })
}

function _currentTrack(channel, cb, err) {
  sonos.currentTrack().then(track => {
    logger.info('Got current track: ' + track)
    if (err) {
      logger.error(err + ' ' + track)
      if (cb) {
        return cb(err, null)
      }
    } else {
      if (cb) {
        return cb(null, track)
      }

      logger.info(track)
      var fmin = '' + Math.floor(track.duration / 60)
      fmin = fmin.length === 2 ? fmin : '0' + fmin
      var fsec = '' + track.duration % 60
      fsec = fsec.length === 2 ? fsec : '0' + fsec

      var pmin = '' + Math.floor(track.position / 60)
      pmin = pmin.length === 2 ? pmin : '0' + pmin
      var psec = '' + track.position % 60
      psec = psec.length === 2 ? psec : '0' + psec

      var message = `We're rocking out to *${track.artist}* - *${track.title}* (${pmin}:${psec}/${fmin}:${fsec})`
      _slackMessage(message, channel)
    }
  }).catch(err => {
    logger.error('Error occurred ' + err)
  })
}

function _currentTrackTitle(channel, cb) {
  sonos.currentTrack().then(track => {
    logger.info('Got current track ' + track)

    var _track = ''

    _track = track.title
    logger.info('_currentTrackTitle > title: ' + _track)
    logger.info('_currentTrackTitle > gongTrack: ' + gongTrack)

    if (gongTrack !== '') {
      if (gongTrack !== _track) {
        logger.info('_currentTrackTitle > different track, reset!')
        gongCounter = 0
        gongScore = {}
        gongBanned = false
        voteImmuneCounter = 0
        voteImmuneScore = {}
      } else {
        logger.info('_currentTrackTitle > gongTrack is equal to _track')
      }
    } else {
      logger.info('_currentTrackTitle > gongTrack is empty')
    }
    gongTrack = _track
    logger.info('_currentTrackTitle > last step, got _track as: ' + _track)

    cb(null, _track)
  }).catch(err => {
    logger.error('Error occurred: ' + err)
  })
}

async function _add(input, channel, userName) {
  _logUserAction(userName, 'add');

  logger.info('userName = ' + userName);

  // Fetch the actual userName using the _checkUser function
  const actualUserName = await _checkUser(userName.replace(/[<@>]/g, ''));

  // Format the userName to match the blacklist entries
  const formattedUserName = actualUserName ? actualUserName.toLowerCase() : userName.toLowerCase();

  logger.info('Checking if user is blacklisted: ' + formattedUserName);

  // Check if the user is on the blacklist
  logger.info('Checking the following user: ' + formattedUserName);
  logger.info('Current blacklist: ' + JSON.stringify(blacklist, null, 2));
  if (blacklist.includes(formattedUserName)) {
    logger.info('User is on the blacklist: ' + formattedUserName);
    _slackMessage("Well... this is awkward.. U're *blacklisted*! ", channel);
    return;
  }

  let data, message;
  try {
    [data, message] = await spotify.searchSpotify(input, channel, formattedUserName, 1);
  } catch (error) {
    logger.error('Error searching Spotify: ' + error);
    _slackMessage('Error searching Spotify.', channel);
    return;
  }

  if (!data || !data.tracks || !data.tracks.items || data.tracks.items.length === 0) {
    _slackMessage('No tracks found for the given input.', channel);
    return;
  }
  if (message) {
    _slackMessage(message, channel);
  }
  if (!data) {
    return;
  }

  // Define the URI, album image, and track name before using them
  let trackItem = data.tracks.items[0];
  let uri = trackItem.uri;
  let albumImg = trackItem.album.images[0].url;
  let trackName = trackItem.artists[0].name + ' - ' + trackItem.name;
  let titleName = trackItem.name;

  // Check Sonos state
  sonos.getCurrentState().then(async state => {
    logger.info('Got current state: ' + state);

    if (state === 'stopped') {
      try {
        await sonos.flush();
        logger.info('Flushed queue');
        await _addToSpotify(formattedUserName, uri, albumImg, trackName, channel);
        logger.info('Adding track:' + trackName);
        setTimeout(async () => {
          await _playInt('play', channel);
          logger.info('Started playing');
        }, 500);
      } catch (err) {
        logger.error('Error during flush or add to Spotify: ' + err);
      }
    } else if (state === 'playing') {
      try {
        const result = await sonos.getQueue();
        logger.info('Searching for duplicated track:' + titleName);
        let trackFound = false;
        for (var i in result.items) {
          var queueTrack = result.items[i].title;
          if (titleName === queueTrack) {
            trackFound = true;
            break;
          }
        }
        if (trackFound) {
          _slackMessage("Track already in queue.. letting it go this time " + formattedUserName + "....", channel);
        } else {
          logger.info('State: ' + state + ' - playing...');
          await _addToSpotify(formattedUserName, uri, albumImg, trackName, channel);
        }
      } catch (err) {
        logger.error('Error fetching queue: ' + err);
      }
    } else if (state === 'paused') {
      _slackMessage("SlackONOS is currently paused.. ask an admin to resume...", channel);
    }
  }).catch(err => {
    logger.error('Error getting current state: ' + err);
  });
}

function _addalbum(input, channel, userName) {
  _logUserAction(userName, 'addalbum');

  var [data, message] = spotify.searchSpotifyAlbum(input, channel, userName, 1)
  if (message) {
    _slackMessage(message, channel)
  }
  if (!data) {
    return
  }

  var uri = data.albums.items[0].uri
  var trackName = data.albums.items[0].artists[0].name + ' - ' + data.albums.items[0].name
  var albumImg = data.albums.items[0].images[2].url

  logger.info('Adding album: ' + trackName + ' with UID:' + uri)

  sonos.getCurrentState().then(state => {
    logger.info('Got current state: ' + state)

    if (state === 'stopped') {
      _flushInt(input, channel)
      _addToSpotify(userName, uri, albumImg, trackName, channel)
      logger.info('Adding album:' + trackName)
      // Start playing the queue automatically.
      setTimeout(() => _playInt('play', channel), 1000)
    } else if (state === 'playing') {
      // Add the track to playlist...
      _addToSpotify(userName, uri, albumImg, trackName, channel)
    } else if (state === 'paused') {
      _addToSpotify(userName, uri, albumImg, trackName, channel, function () {
        if (channel === global.adminChannel) {
          _slackMessage('Sonos is currently PAUSED. Type `resume` to start playing...', channel)
        }
      })
    } else if (state === 'transitioning') {
      _slackMessage("Sonos says it is 'transitioning'. We've got no idea what that means either...", channel)
    } else if (state === 'no_media') {
      _slackMessage("Sonos reports 'no media'. Any idea what that means?", channel)
    } else {
      _slackMessage("Sonos reports its state as '" + state + "'. Any idea what that means? I've got nothing.", channel)
    }
  }).catch(err => {
    logger.error('Error occurred ' + err)
  })
}

function _append(input, channel, userName) {
  var [data, message] = spotify.searchSpotify(input, channel, userName, 1)
  if (message) {
    _slackMessage(message, channel)
  }
  if (!data) {
    return
  }

  var uri = data.tracks.items[0].uri
  var albumImg = data.tracks.items[0].album.images[2].url
  var trackName = data.tracks.items[0].artists[0].name + ' - ' + data.tracks.items[0].name

  logger.info('Adding track: ' + trackName + ' with UID:' + uri)

  sonos.getCurrentState().then(state => {
    logger.info('Got current state: ' + state)

    if (state === 'stopped') {
      logger.info('State: ' + state + ' - apending')
      _addToSpotify(userName, uri, albumImg, trackName, channel)
      logger.info('Adding track:' + trackName)
      setTimeout(() => _playInt('play', channel), 1000)
    } else if (state === 'playing') {
      logger.info('State: ' + state + ' - adding...')
      // Add the track to playlist...
      _addToSpotify(userName, uri, albumImg, trackName, channel)
    } else if (state === 'paused') {
      logger.info('State: ' + state + ' - telling them no...')
      _addToSpotify(userName, uri, albumImg, trackName, channel, function () {
        if (channel === global.adminChannel) {
          _slackMessage('Sonos is currently PAUSED. Type `resume` to start playing...', channel)
        }
      })
    } else if (state === 'transitioning') {
      logger.info('State: ' + state + ' - no idea what to do')
      _slackMessage("Sonos says it is 'transitioning'. We've got no idea what that means either...", channel)
    } else if (state === 'no_media') {
      _slackMessage("Sonos reports 'no media'. Any idea what that means?", channel)
    } else {
      _slackMessage("Sonos reports its state as '" + state + "'. Any idea what that means? I've got nothing.", channel)
    }
  }).catch(err => {
    logger.error('Error occurred' + err)
  })
}

async function _search(input, channel, userName) {
  _logUserAction(userName, 'search');
  logger.info('_search ' + input)
  var [data, message] = spotify.searchSpotify(input, channel, userName, searchLimit)

  if (message) {
    _slackMessage(message, channel)
  }
  if (!data) {
    return
  }

  var trackNames = []
  for (var i = 1; i <= data.tracks.items.length; i++) {
    var trackName = data.tracks.items[i - 1].name + ' - ' + data.tracks.items[i - 1].artists[0].name
    trackNames.push(trackName)
  }

  // Print the result...
  message = userName +
    ', I found the following track(s):\n```\n' +
    trackNames.join('\n') +
    '\n```\nIf you want to play it, use the `add` command..\n'

  _slackMessage(message, channel)
}

async function _searchplaylist(input, channel, userName) {
  _logUserAction(userName, 'searchplaylist');
  logger.info('_searchplaylist ' + input);

  // Ensure userName is defined; set a fallback if it’s undefined
  userName = userName || "User";

  const [data, message] = await spotify.searchSpotifyPlaylist(input, channel, userName, searchLimit);

  if (message) {
    _slackMessage(message, channel);
  }

  // Log the full response from Spotify API
  // logger.info('Spotify API response: ' + JSON.stringify(data, null, 2));

  if (!data || !data.playlists || !data.playlists.items || data.playlists.items.length === 0) {
    logger.info('No playlists found for the given input.');
    _slackMessage('No playlists found for the given input.', channel);
    return;
  }

  // Filter out null items
  const validPlaylists = data.playlists.items.filter(playlist => playlist !== null);

  // logger.info('Valid playlists found: ' + JSON.stringify(validPlaylists, null, 2));

  var playlistNames = [];
  for (let i = 0; i < validPlaylists.length; i++) {
    const playlist = validPlaylists[i];
    const playlistName = playlist.name;
    playlistNames.push(playlistName);
  }

  // Print the result...
  const resultMessage = userName +
    ', I found the following playlist(s):\n```\n' +
    playlistNames.join('\n') +
    '\n```\nIf you want to play it, use the `addplaylist` command..\n';
  _slackMessage(resultMessage, channel);
}



// FIXME - misnamed s/ add to sonos, appears funcionally identical to _addToSpotifyPlaylist
// function _addToSpotify (userName, uri, albumImg, trackName, channel, cb) {
function _addToSpotify(userName, uri, albumImg, trackName, channel, cb) {
  logger.info('_addToSpotify ' + uri)
  sonos.queue(uri).then(result => {
    logger.info('Queued the following: ' + result)

    logger.info('queue:')
    var queueLength = result.FirstTrackNumberEnqueued
    logger.info('queueLength' + queueLength)
    var message = 'Sure ' +
      userName +
      ', Added ' +
      trackName +
      ' to the queue!\n' +
      albumImg +
      '\nPosition in queue is ' +
      queueLength

    _slackMessage(message, channel)
  }).catch(err => {
    _slackMessage('Error! No spotify account?', channel)
    logger.error('Error occurred: ' + err)
  })
}

function _addToSpotifyPlaylist(userName, uri, trackName, channel, cb) {
  logger.info('TrackName:' + trackName)
  logger.info('URI:' + uri)
  sonos.queue(uri).then(result => {
    logger.info('Queued the following: ' + result)

    var queueLength = result.FirstTrackNumberEnqueued
    var message = 'Sure ' +
      userName +
      ', Added "' +
      trackName +
      '" to the queue!\n' +
      '\nPosition in queue is ' +
      queueLength

    _slackMessage(message, channel)
  }).catch(err => {
    _slackMessage('Error! No spotify account?', channel)
    logger.error('Error occurred: ' + err)
  })
}

function _addToSpotifyArtist(userName, trackName, spid, channel) {
  logger.info('_addToSpotifyArtist spid:' + spid)
  logger.info('_addToSpotifyArtist trackName:' + trackName)

  var uri = 'spotify:artistTopTracks:' + spid
  sonos.queue(uri).then(result => {
    logger.info('Queued the following: ' + result)

    var queueLength = result.FirstTrackNumberEnqueued
    logger.info('queueLength' + queueLength)
    var message = 'Sure ' +
      userName +
      ' Added 10 most popular tracks by "' +
      trackName +
      '" to the queue!\n' +
      '\nPosition in queue is ' +
      queueLength

    _slackMessage(message, channel)
  }).catch(err => {
    _slackMessage('Error! No spotify account?', channel)
    logger.error('Error occurred: ' + err)
  })
}

async function _addplaylist(input, channel, userName) {
  _logUserAction(userName, '_addplaylist');
  logger.info('_addplaylist ' + input);
  const [data, message] = await spotify.searchSpotifyPlaylist(input, channel, userName, searchLimit);

  if (message) {
    _slackMessage(message, channel);
  }

  if (!data || !data.playlists || !data.playlists.items || data.playlists.items.length === 0) {
    _slackMessage('No playlists found for the given input.', channel);
    return;
  }

  //  logger.info('Playlists found: ' + JSON.stringify(data.playlists.items, null, 2));

  // Select the first playlist from the search results
  const playlist = data.playlists.items[0];
  if (!playlist) {
    logger.error('Playlist item is null or undefined at index: 0');
    _slackMessage('No valid playlists found for the given input.', channel);
    return;
  }

  const uri = playlist.uri;
  const albumImg = playlist.images[2]?.url || 'No image available';
  const playlistName = playlist.name;

  logger.info('Adding playlist: ' + playlistName + ' with URI: ' + uri);

  sonos.getCurrentState().then(state => {
    logger.info('Got current state: ' + state);

    if (state === 'stopped') {
      _flushInt(input, channel);
      logger.info('State: ' + state + ' - appending');
      _addToSpotify(userName, uri, albumImg, playlistName, channel);
      logger.info('Adding playlist: ' + playlistName);
      setTimeout(() => _playInt('play', channel), 1000);
    } else if (state === 'playing') {
      logger.info('State: ' + state + ' - adding...');
      _addToSpotify(userName, uri, albumImg, playlistName, channel);
    } else if (state === 'paused') {
      logger.info('State: ' + state + ' - telling them no...');
      _addToSpotify(userName, uri, albumImg, playlistName, channel, function () {
        if (channel === global.adminChannel) {
          _slackMessage('Sonos is currently PAUSED. Type `resume` to start playing...', channel);
        }
      });
    }
  }).catch(err => {
    logger.error('Error getting current state: ' + err);
  });
}


function _bestof(input, channel, userName) {
  _logUserAction(userName, 'bestof');
  var [data, message] = spotify.searchSpotifyArtist(input, channel, userName, 1)
  if (message) {
    _slackMessage(message, channel)
  }
  if (!data) {
    return
  }
  logger.debug('Result in _bestof: ' + JSON.stringify(data, null, 2))
  var trackNames = []
  for (var i = 1; i <= data.artists.items.length; i++) {
    var spid = data.artists.items[0].id
    var trackName = data.artists.items[i - 1].name
    trackNames.push(trackName)
  }
  logger.info('_bestof spid:' + spid)
  logger.info('_bestof trackName:' + trackName)

  sonos.getCurrentState().then(state => {
    logger.info('Got current state: ' + state)

    if (state === 'stopped') {
      _flushInt(input, channel)
      _addToSpotifyArtist(userName, trackName, spid, channel)
      logger.info('Adding artist:' + trackName)
      setTimeout(() => _playInt('play', channel), 1000)
    } else if (state === 'playing') {
      // Add the track to playlist...
      _addToSpotifyArtist(userName, trackName, spid, channel)
    } else if (state === 'paused') {
      _addToSpotifyArtist(userName, trackName, spid, channel, function () {
        if (channel === global.adminChannel) {
          _slackMessage('Sonos is currently PAUSED. Type `resume` to start playing...', channel)
        }
      })
    } else if (state === 'transitioning') {
      _slackMessage("Sonos says it is 'transitioning'. We've got no idea what that means either...", channel)
    } else if (state === 'no_media') {
      _slackMessage("Sonos reports 'no media'. Any idea what that means?", channel)
    } else {
      _slackMessage("Sonos reports its state as '" + state + "'. Any idea what that means? I've got nothing.", channel)
    }
  }).catch(err => {
    logger.error('Error occurred ' + err)
  })
}

function _status(channel, state) {
  sonos.getCurrentState().then(state => {
    logger.info('Got current state: ' + state)
    _slackMessage("Sonos state is '" + state + "'", channel)
  }).catch(err => {
    logger.error('Error occurred ' + err)
  })
}

// Ensure the _debug function is defined
async function _debug(channel, userName) {
  _logUserAction(userName, 'debug');
  var url = 'http://' + sonosIp + ':1400/xml/device_description.xml';

  // Function to get the IP address of the machine (Docker container if inside Docker)
  function getIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return 'IP address not found';
  }

  // Improved function to check if running inside Docker
  function isRunningInDocker() {
    try {
      // Check if running in Docker by inspecting /proc/1/cgroup and the presence of .dockerenv
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
      if (cgroup.includes('docker')) {
        return true;
      }
    } catch (err) {
      // Ignore errors, continue to next check
    }

    try {
      // Check if .dockerenv file exists (another indication of being inside Docker)
      if (fs.existsSync('/.dockerenv')) {
        return true;
      }
    } catch (err) {
      // Ignore errors
    }

    return false; // Default to not inside Docker if all checks fail
  }

  // Function to get the host's IP address if running inside Docker
  function getHostIPAddress() {
    try {
      const result = fs.readFileSync('/proc/net/route', 'utf8');
      const lines = result.split('\n');

      for (const line of lines) {
        const columns = line.trim().split(/\s+/);

        // Look for the default route (Destination is 00000000)
        if (columns[1] === '00000000') {
          const hexIp = columns[2];  // Gateway IP is in the third column
          const gatewayIp = hexToIp(hexIp);
          return gatewayIp;
        }
      }

      return 'Host IP address not found';
    } catch (err) {
      return 'Host IP address not found';
    }
  }

  // Helper function to convert hex IP from /proc/net/route to a readable IP address
  function hexToIp(hex) {
    return [
      parseInt(hex.slice(6, 8), 16),
      parseInt(hex.slice(4, 6), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(0, 2), 16)
    ].join('.');
  }

  const isDocker = isRunningInDocker();  // Improved check for Docker environment

  if (isDocker) {
    // Check if IP is defined in the environment
    // Get the IP address from the configuration
    console.log('IP Address from config:', ipAddress);
    if (!ipAddress) {
      // Log error and set a default value for IP
      const warningMessage = 'Make sure you have configured IP in the config.json';
      logger.error(warningMessage);
      ipAddress = warningMessage; // Set the value of IP to the warning message
    }
  } else {
    ipAddress = getIPAddress();  // IP of the machine if not in Docker
  }

  const dockerIPAddress = isDocker ? getHostIPAddress() : null;  // Host IP if running inside Docker

  // Define nodeVersion outside the if block
  const nodeVersion = JSON.stringify(process.versions);

  xmlToJson(url, async function (err, data) {
    let sonosInfo = '';
    if (err) {
      logger.error('Error occurred ' + err);
      sonosInfo = 'SONOS device is offline or not responding.';
    } else {
      logger.info('BuildNumber of SlackONOS: ', buildNumber);
      logger.info('Platform: ', process.platform);
      logger.info('Node version: ', process.version);
      logger.info('Node dependencies: ', process.versions);

      // Log Sonos information
      logger.info(data.root.device[0].modelDescription);
      logger.info(data.root.device[0].softwareVersion);
      logger.info(data.root.device[0].displayName);
      logger.info(data.root.device[0].hardwareVersion);
      logger.info(data.root.device[0].apiVersion);
      logger.info(data.root.device[0].roomName);
      logger.info(data.root.device[0].friendlyName);
      logger.info(data.root.device[0].modelNumber);
      logger.info(data.root.device[0].serialNum);
      logger.info(data.root.device[0].MACAddress);

      sonosInfo =
        '\n*Sonos Info*' +
        '\nFriendly Name:  ' + (data.root.device[0].friendlyName) +
        '\nRoom Name:  ' + (data.root.device[0].roomName) +
        '\nDisplay Name:  ' + (data.root.device[0].displayName) +
        '\nModel Description:  ' + (data.root.device[0].modelDescription) +
        '\nModelNumber:  ' + (data.root.device[0].modelNumber) +
        '\nSerial Number:  ' + (data.root.device[0].serialNum) +
        '\nMAC Address:  ' + (data.root.device[0].MACAddress) +
        '\nSW Version:  ' + (data.root.device[0].softwareVersion) +
        '\nHW Version:  ' + (data.root.device[0].hardwareVersion) +
        '\nAPI Version:  ' + (data.root.device[0].apiVersion);
    }

    // Get memory usage
    const memoryUsage = process.memoryUsage();
    const formattedMemoryUsage = `
*Memory Usage*:
  RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB
  Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB
  Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB
  External: ${Math.round(memoryUsage.external / 1024 / 1024)} MB
  Array Buffers: ${Math.round(memoryUsage.arrayBuffers / 1024 / 1024)} MB
`;

    // Get uptime
    const uptime = process.uptime();
    const formattedUptime = `
*Uptime*: ${Math.floor(uptime / 60)} minutes ${Math.floor(uptime % 60)} seconds
`;

    // Get network interfaces
    const networkInterfaces = os.networkInterfaces();
    const formattedNetworkInterfaces = Object.entries(networkInterfaces).map(([name, addresses]) => {
      return addresses.map(addr => `${name}: ${addr.address}`).join('\n');
    }).join('\n');

    // Get disk usage (example for Unix-like systems)
    const diskUsage = execSync('df -h /').toString();
    const formattedDiskUsage = `
*Disk Usage*:
${diskUsage}
`;



    // Read configuration values only from config.json
    const configKeys = Object.keys(config.stores.file.store); // Access only the file-based store
    const configValues = configKeys.map(key => `${key}: ${config.get(key)}`).join('\n');

    // Debug log for verification
    logger.info('DEBUG -- Config values from config.json: ' + configValues);

    // Ensure environment variables are handled separately
    const envVars = `
*Environment Variables*:
  NODE_VERSION: ${process.env.NODE_VERSION || 'not set'}
  HOSTNAME: ${process.env.HOSTNAME || 'not set'}
  YARN_VERSION: ${process.env.YARN_VERSION || 'not set'}
  HOME: ${process.env.HOME || 'not set'}
  PATH: ${process.env.PATH}
  PWD: ${process.env.PWD}
`;

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*SlackONOS Info*\nBuildNumber: ' + buildNumber
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Spotify Info*\nMarket: ' + market
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: sonosInfo
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: formattedMemoryUsage
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: formattedUptime
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: envVars
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Network Interfaces*\n' + formattedNetworkInterfaces
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: formattedDiskUsage
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Configuration Values*\n' + configValues
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: envVars
        }
      }
    ];

    const message = {
      channel: channel,
      blocks: blocks
    };

    try {
      await web.chat.postMessage(message);
    } catch (err) {
      logger.error('Error sending debug message: ' + err);
      _slackMessage('Error sending debug message.', channel);
    }
  });
}





async function _blacklist(input, channel, userName) {
  _logUserAction(userName, 'blacklist');
  if (channel !== global.adminChannel) {
    return;
  }

  const action = input[1] ? input[1] : '';
  const slackUser = input[2] ? input[2].replace(/[<@>]/g, '') : '';

  let message = '';

  if (slackUser !== '') {
    var userNameToCheck = await _checkUser(slackUser);
  }

  if (action === '') {
    // Fetch usernames for each user ID in the blacklist
    const usernames = await Promise.all(blacklist.map(async (userName) => {
      return `@${userName}`;
    }));

    message = 'The following users are blacklisted:\n```\n' + usernames.join('\n') + '\n```';
  } else if (typeof userNameToCheck !== 'undefined') {
    const displayName = `@${userNameToCheck}`;

    if (action === 'add') {
      if (!blacklist.includes(userNameToCheck)) {
        blacklist.push(userNameToCheck);
        message = `The user ${displayName} has been added to the blacklist.`;
      } else {
        message = `The user ${displayName} is already on the blacklist.`;
      }
    } else if (action === 'del') {
      const index = blacklist.indexOf(userNameToCheck);
      if (index !== -1) {
        blacklist.splice(index, 1);
        message = `The user ${displayName} has been removed from the blacklist.`;
      } else {
        message = `The user ${displayName} is not on the blacklist.`;
      }
    } else {
      message = 'Usage: `blacklist add|del @username`';
    }
  } else {
    message = 'Usage: `blacklist add|del @username`';
  }

  if (message) {
    _slackMessage(message, channel);
  } else {
    logger.error('No message to send to Slack.');
  }
}

let serverInstance = null;

async function _tts(input, channel) {

  // Get random message
  logger.info('ttsMessage.length: ' + ttsMessage.length)
  var ran = Math.floor(Math.random() * ttsMessage.length)
  var ttsSayMessage = ttsMessage[ran]
  logger.info('ttsMessage: ' + ttsSayMessage)
  message = input.slice(1).join(' ')

  const text = ttsSayMessage + "... Message as follows... " + message + ".... I repeat...  " + message; // Remove the leading "say"
  const filePath = path.join(__dirname, 'tts.mp3');
  _slackMessage(':mega:' + ' ' + ttsSayMessage + ':  ' + '*' + message + '*', standardChannel);
  _slackMessage('I will post the message in the music channel: ' + standardChannel + ', for you', channel);
  logger.info('Generating TTS for text: ' + text);

  try {
    const positionInfo = await sonos.avTransportService().GetPositionInfo();
    logger.info('Current Position: ' + JSON.stringify(positionInfo.Track));

    // Ensure previous TTS file is deleted
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Synchronous cleanup of previous file before creating a new one
      logger.info('Old TTS file deleted before generating a new one.');
    }

    // Stop any curre nt playback before generating new TTS
    try {
      await sonos.stop();  // Stop any current playback before starting a new one
      logger.info('Previous track stopped.');
    } catch (error) {
      logger.warn('No track was playing or error stopping the track: ' + error.message);
    }



    // Generate the TTS file using gtts
    await new Promise((resolve, reject) => {
      const gtts = new GTTS(text, 'en'); // 'en' stands for English language
      gtts.save(filePath, (err) => {
        if (err) {
          reject('TTS generation error: ' + err.message);
        } else {
          logger.info('TTS file generated successfully');
          resolve();
        }
      });
    });

    // If the server is running, close and reset it
    if (serverInstance) {
      serverInstance.close(() => {
        logger.info('Previous server instance closed.');
      });
      serverInstance = null; // Reset the instance
    }

    // Create the server to serve the TTS file
    serverInstance = http.createServer((req, res) => {
      if (req.url === '/tts.mp3') {
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(500);
            res.end('Internal Server Error');
          } else {
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Content-Disposition': 'attachment; filename="tts.mp3"',
            });
            res.end(data);
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    serverInstance.listen(webPort, () => {
      logger.info('Server is listening on port ' + webPort);
    });

    serverInstance.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn('Port ' + webPort + ' is already in use. Reusing the existing server.');
      } else {
        logger.error('Server error: ' + err);
      }
    });

    process.on('SIGTERM', () => {
      if (serverInstance) {
        serverInstance.close(() => {
          logger.info('Server closed gracefully.');
          process.exit(0);
        });
      }
    });

    // Wait for the server to be ready before playing
    await delay(2000); // Increased delay

    // Play the TTS file
    await sonos.play('http://' + ipAddress + ':' + webPort + '/tts.mp3')
      .then(() => {
        logger.info('Playing notification...');
      })
      .catch((error) => {
        logger.error('Error occurred during playback: ' + JSON.stringify(error));
      });

    // Determine the duration of the MP3 file
    const mp3Length = await new Promise((resolve, reject) => {
      mp3Duration(filePath, (err, duration) => {
        if (err) {
          reject('Error fetching MP3 duration: ' + err.message);
        } else {
          logger.info('MP3 duration: ' + duration + ' seconds');
          resolve(duration);
        }
      });
    });

    // Delay based on the actual MP3 length
    await delay(mp3Length * 1000); // Convert seconds to milliseconds

    const nextToPlay = positionInfo.Track + 1;
    logger.info('Next to play: ' + nextToPlay);

    try {
      await sonos.selectTrack(nextToPlay);
      logger.info('Track selected successfully.');
    } catch (error) {
      logger.info('Jumping to next track failed: ' + error);
    }

    await sonos.play();

  } finally {
    // Cleanup queue and remove the track
    await sonos.getQueue().then((result) => {
      const removeGong = result.total;
      sonos.removeTracksFromQueue([removeGong], 1)
        .then(() => {
          logger.info('Removed track with index: ' + removeGong);
        })
        .catch((err) => {
          logger.error('Error occurred while removing track: ' + err);
        });
    });

    // Remove the TTS file
    fs.unlink(filePath, (err) => {
      if (err) {
        logger.error('Error deleting the TTS file: ' + err.message);
      } else {
        logger.info('TTS file deleted successfully');
      }
    });
  }
}




function _purgeHalfQueue(input, channel) {
  sonos.getQueue().then(result => {
    let maxQueueIndex = parseInt(result.total)
    const halfQueueSize = Math.floor(maxQueueIndex / 2)
    for (let i = 0; i < halfQueueSize; i++) {
      const rand = utils.getRandomInt(0, maxQueueIndex)
      _removeTrack(rand, channel, function (success) {
        if (success) {
          maxQueueIndex--
        }
      })
    }
    const snapUrl = 'https://cdn3.movieweb.com/i/article/61QmlwoK2zbKcbLyrLncM3gPrsjNIb/738:50/Avengers-Infinity-War-Facebook-Ar-Mask-Thanos-Snap.jpg'
    _slackMessage(snapUrl + '\nThanos has restored balance to the playlist', channel)
  }).catch(err => {
    logger.error(err)
  })
}

async function _stats(input, channel, userName) {
  let userActions = {};

  logger.info('Starting _stats function');
  logger.info(`Input received: ${JSON.stringify(input)}, Channel: ${channel}, UserName: ${userName}`);

  // Ensure the file exists
  if (!fs.existsSync(userActionsFile)) {
    logger.warn('userActionsFile does not exist.');
    _slackMessage('No statistics available.', channel);
    return;
  }

  // Read existing user actions from the file
  try {
    const data = fs.readFileSync(userActionsFile, 'utf8');
    logger.info('Successfully read userActionsFile.');
    userActions = JSON.parse(data);
    logger.info(`Loaded userActions: ${JSON.stringify(userActions, null, 2)}`);
  } catch (err) {
    logger.error('Error reading or parsing userActions.json: ' + err);
    _slackMessage('Error reading statistics.', channel);
    return;
  }

  const userId = input[1] ? input[1].replace(/[<@>]/g, '') : null;
  const userKey = input[1]; // Use the full "<@U03JJ5LN4>" format from the input
  logger.info(`Extracted userId: ${userId}, userKey: ${userKey}`);

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*User Statistics*'
      }
    },
    {
      type: 'divider'
    }
  ];

  if (userKey) {
    // Show stats for the specific user
    const userStats = userActions[userKey]; // Use userKey which matches the stored key format
    logger.info(`Found stats for userKey: ${userKey}: ${JSON.stringify(userStats)}`);
    if (!userStats) {
      _slackMessage(`No statistics available for user: ${userKey}`, channel);
      return;
    }

    const fields = Object.entries(userStats)
      .slice(0, 10) // Limit to the first 10 entries
      .map(([action, count]) => ({
        type: 'mrkdwn',
        text: `*${action}*: ${count}`
      }));

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${userKey}*`
      },
      fields: fields
    });
  } else {
    // Show stats for the top 10 users
    logger.info('Fetching stats for the top 10 users.');
    const topUsers = Object.entries(userActions)
      .sort(([, a], [, b]) => Object.values(b).reduce((sum, count) => sum + count, 0) - Object.values(a).reduce((sum, count) => sum + count, 0))
      .slice(0, 10);

    logger.info(`Top 10 users: ${JSON.stringify(topUsers)}`);

    topUsers.forEach(([userKey, userStats]) => {
      const fields = Object.entries(userStats)
        .slice(0, 10) // Limit to the first 10 entries
        .map(([action, count]) => ({
          type: 'mrkdwn',
          text: `*${action}*: ${count}`
        }));

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${userKey}*`
        },
        fields: fields
      });
      blocks.push({
        type: 'divider'
      });
    });
  }

  // Validate the channel ID
  if (!channel || typeof channel !== 'string') {
    logger.error('Invalid channel ID');
    _slackMessage('Error: Invalid channel ID.', channel);
    return;
  }

  // Send the formatted message to the specified Slack channel
  const message = {
    channel: channel,
    text: 'User Statistics', // Add text argument
    blocks: blocks
  };

  try {
    await web.chat.postMessage(message);
    logger.info('Successfully sent statistics message.');
  } catch (err) {
    logger.error('Error sending statistics message: ' + err);
    _slackMessage('Error sending statistics message.', channel);
  }
}



function _logUserAction(userName, action) {
  let userActions = {};

  // Ensure the file exists
  if (!fs.existsSync(userActionsFile)) {
    fs.writeFileSync(userActionsFile, JSON.stringify({}), 'utf8');
  }

  // Read existing user actions from the file
  try {
    const data = fs.readFileSync(userActionsFile, 'utf8');
    userActions = JSON.parse(data);
  } catch (err) {
    logger.error('Error reading or parsing userActions.json: ' + err);
    userActions = {};
  }

  // Initialize user actions if not already present
  if (!userActions[userName]) {
    userActions[userName] = {};
  }

  // Initialize action count if not already present
  if (!userActions[userName][action]) {
    userActions[userName][action] = 0;
  }

  // Increment the action count
  userActions[userName][action] += 1;

  // Write updated user actions back to the file
  try {
    fs.writeFileSync(userActionsFile, JSON.stringify(userActions, null, 2), 'utf8');
  } catch (err) {
    logger.error('Error writing to userActions.json: ' + err);
  }

  logger.info(`Logged action: ${action} for user: ${userName}`);
}



// Function to parse XML to JSON

function xmlToJson(url, callback) {
  var req = http.get(url, function (res) {
    logger.info(req)
    var xml = ''
    res.on('data', function (chunk) { xml += chunk })
    res.on('error', function (e) { callback(e, null) })
    res.on('timeout', function (e) { callback(e, null) })
    res.on('end', function () { parseString(xml, function (e, result) { callback(null, result) }) })
  })
}

// Travis.
// Just making sure that is at least will build...

module.exports = function (number, locale) {
  return number.toLocaleString(locale)
}
