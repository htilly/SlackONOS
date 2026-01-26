/**
 * Slack Mock for Testing
 * Provides mocks for Slack WebClient and SocketModeClient
 */

import sinon from 'sinon';

/**
 * Create a mock Slack WebClient
 * @param {Object} options - Configuration options
 * @returns {Object} Mock WebClient
 */
export function createWebClientMock(options = {}) {
  const defaultAuth = {
    user_id: 'U123BOT',
    bot_id: 'B123BOT',
    team_id: 'T123TEAM',
    team: 'Test Team'
  };

  const defaultChannel = {
    id: 'C123CHANNEL',
    name: 'music',
    is_channel: true,
    is_member: true
  };

  const defaultChannelsList = {
    channels: [
      { id: 'C123ADMIN', name: 'music-admin', is_channel: true, is_member: true },
      { id: 'C123MUSIC', name: 'music', is_channel: true, is_member: true }
    ],
    response_metadata: { next_cursor: '' }
  };

  const sentMessages = [];

  const mock = {
    auth: {
      test: sinon.stub().resolves(options.auth || defaultAuth)
    },
    
    chat: {
      postMessage: sinon.stub().callsFake(async (params) => {
        sentMessages.push(params);
        return {
          ok: true,
          channel: params.channel,
          ts: Date.now().toString(),
          message: { text: params.text }
        };
      }),
      update: sinon.stub().resolves({ ok: true }),
      delete: sinon.stub().resolves({ ok: true })
    },
    
    conversations: {
      list: sinon.stub().resolves(options.channelsList || defaultChannelsList),
      info: sinon.stub().resolves({ channel: options.channel || defaultChannel }),
      history: sinon.stub().resolves({ messages: [], has_more: false }),
      members: sinon.stub().resolves({ members: ['U123', 'U456'] })
    },
    
    users: {
      info: sinon.stub().resolves({
        user: {
          id: 'U123USER',
          name: 'testuser',
          real_name: 'Test User',
          is_admin: false,
          is_bot: false
        }
      }),
      list: sinon.stub().resolves({
        members: [
          { id: 'U123USER', name: 'testuser', is_bot: false },
          { id: 'U123BOT', name: 'slackonos', is_bot: true }
        ]
      })
    },
    
    reactions: {
      add: sinon.stub().resolves({ ok: true }),
      remove: sinon.stub().resolves({ ok: true }),
      get: sinon.stub().resolves({ message: { reactions: [] } })
    },

    // Helper methods for tests
    _getSentMessages: () => sentMessages,
    _clearSentMessages: () => { sentMessages.length = 0; },
    _reset: function() {
      sentMessages.length = 0;
      Object.keys(mock).forEach(key => {
        if (mock[key] && typeof mock[key] === 'object') {
          Object.keys(mock[key]).forEach(method => {
            if (mock[key][method] && typeof mock[key][method].reset === 'function') {
              mock[key][method].reset();
            }
          });
        }
      });
    }
  };

  return mock;
}

/**
 * Create a mock SocketModeClient
 * @param {Object} options - Configuration options
 * @returns {Object} Mock SocketModeClient
 */
export function createSocketModeClientMock(options = {}) {
  const eventHandlers = new Map();
  
  const mock = {
    start: sinon.stub().resolves(),
    disconnect: sinon.stub().resolves(),
    
    on: sinon.stub().callsFake((event, handler) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event).push(handler);
    }),
    
    off: sinon.stub().callsFake((event, handler) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) handlers.splice(index, 1);
      }
    }),

    // Helper methods for tests
    _emit: async function(event, data) {
      const handlers = eventHandlers.get(event) || [];
      for (const handler of handlers) {
        await handler(data);
      }
    },
    
    _getHandlers: (event) => eventHandlers.get(event) || [],
    
    _reset: function() {
      eventHandlers.clear();
      mock.start.reset();
      mock.disconnect.reset();
      mock.on.reset();
      mock.off.reset();
    }
  };

  return mock;
}

/**
 * Create a complete Slack system mock (combines WebClient + SocketMode)
 */
export function createSlackSystemMock(options = {}) {
  const webClient = createWebClientMock(options);
  const socketMode = createSocketModeClientMock(options);
  
  return {
    web: webClient,
    socket: socketMode,
    
    // Simulate incoming message event
    simulateMessage: async function(text, channel, user, isAdmin = false) {
      const event = {
        type: 'message',
        text,
        channel,
        user,
        ts: Date.now().toString(),
        team: 'T123TEAM'
      };
      
      await socketMode._emit('slack_event', {
        body: { event },
        ack: sinon.stub().resolves()
      });
      
      return event;
    },
    
    // Simulate app_mention event
    simulateMention: async function(text, channel, user) {
      const event = {
        type: 'app_mention',
        text: `<@U123BOT> ${text}`,
        channel,
        user,
        ts: Date.now().toString()
      };
      
      await socketMode._emit('slack_event', {
        body: { event },
        ack: sinon.stub().resolves()
      });
      
      return event;
    },
    
    // Simulate reaction event
    simulateReaction: async function(reaction, channel, messageTs, user) {
      const event = {
        type: 'reaction_added',
        reaction,
        item: { type: 'message', channel, ts: messageTs },
        user,
        event_ts: Date.now().toString()
      };
      
      await socketMode._emit('slack_event', {
        body: { event },
        ack: sinon.stub().resolves()
      });
      
      return event;
    },
    
    _reset: function() {
      webClient._reset();
      socketMode._reset();
    }
  };
}

export default { createWebClientMock, createSocketModeClientMock, createSlackSystemMock };
