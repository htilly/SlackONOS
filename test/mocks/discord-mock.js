/**
 * Discord Mock for Testing
 * Provides mocks for Discord.js Client and related objects
 */

import sinon from 'sinon';

/**
 * Create a mock Discord message
 * @param {Object} options - Configuration options
 * @returns {Object} Mock Message
 */
export function createMessageMock(options = {}) {
  const defaultAuthor = {
    id: 'U123USER',
    username: 'testuser',
    discriminator: '1234',
    bot: false,
    tag: 'testuser#1234'
  };

  const defaultChannel = {
    id: 'C123CHANNEL',
    name: 'music',
    type: 0, // GUILD_TEXT
    send: sinon.stub().resolves({ id: 'M123SENT' })
  };

  const defaultGuild = {
    id: 'G123GUILD',
    name: 'Test Server',
    members: {
      cache: new Map(),
      fetch: sinon.stub().resolves()
    },
    roles: {
      cache: new Map([
        ['R123DJ', { id: 'R123DJ', name: 'DJ' }],
        ['R123ADMIN', { id: 'R123ADMIN', name: 'Admin' }]
      ])
    }
  };

  const defaultMember = {
    id: options.author?.id || 'U123USER',
    user: options.author || defaultAuthor,
    roles: {
      cache: new Map(options.roles || [])
    },
    permissions: {
      has: sinon.stub().returns(options.hasPermission || false)
    }
  };

  const reactions = new Map();

  const mock = {
    id: options.id || 'M123MESSAGE',
    content: options.content || 'test message',
    author: options.author || defaultAuthor,
    channel: options.channel || defaultChannel,
    guild: options.guild || defaultGuild,
    member: options.member || defaultMember,
    createdTimestamp: options.timestamp || Date.now(),
    
    reply: sinon.stub().resolves({ id: 'M123REPLY' }),
    react: sinon.stub().callsFake(async (emoji) => {
      reactions.set(emoji, { emoji, count: 1 });
      return { emoji };
    }),
    delete: sinon.stub().resolves(),
    edit: sinon.stub().resolves(),
    
    reactions: {
      cache: reactions,
      removeAll: sinon.stub().resolves()
    },

    // Helper for tests
    _setContent: function(content) {
      mock.content = content;
    },
    
    _setRoles: function(roleNames) {
      const roleMap = new Map();
      roleNames.forEach((name, idx) => {
        roleMap.set(`R${idx}`, { id: `R${idx}`, name });
      });
      mock.member.roles.cache = roleMap;
    }
  };

  return mock;
}

/**
 * Create a mock Discord Client
 * @param {Object} options - Configuration options
 * @returns {Object} Mock Client
 */
export function createDiscordClientMock(options = {}) {
  const eventHandlers = new Map();
  const sentMessages = [];

  const defaultUser = {
    id: 'U123BOT',
    username: 'slackonos',
    tag: 'slackonos#1234',
    bot: true
  };

  const channels = new Map();
  const guilds = new Map();

  const mock = {
    user: options.user || defaultUser,
    
    channels: {
      cache: channels,
      fetch: sinon.stub().callsFake(async (id) => {
        return channels.get(id) || {
          id,
          name: 'unknown',
          send: sinon.stub().callsFake(async (content) => {
            const msg = { id: `M${Date.now()}`, content };
            sentMessages.push(msg);
            return msg;
          })
        };
      })
    },
    
    guilds: {
      cache: guilds,
      fetch: sinon.stub().resolves()
    },
    
    login: sinon.stub().resolves('token'),
    destroy: sinon.stub().resolves(),
    
    on: sinon.stub().callsFake((event, handler) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event).push(handler);
      return mock;
    }),
    
    once: sinon.stub().callsFake((event, handler) => {
      mock.on(event, handler);
      return mock;
    }),
    
    off: sinon.stub().callsFake((event, handler) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) handlers.splice(index, 1);
      }
      return mock;
    }),
    
    emit: sinon.stub().callsFake((event, ...args) => {
      const handlers = eventHandlers.get(event) || [];
      handlers.forEach(h => h(...args));
      return true;
    }),

    // Helper methods for tests
    _emit: async function(event, ...args) {
      const handlers = eventHandlers.get(event) || [];
      for (const handler of handlers) {
        await handler(...args);
      }
    },
    
    _addChannel: function(id, channel) {
      channels.set(id, channel);
    },
    
    _addGuild: function(id, guild) {
      guilds.set(id, guild);
    },
    
    _getSentMessages: () => sentMessages,
    _clearSentMessages: () => { sentMessages.length = 0; },
    
    _reset: function() {
      eventHandlers.clear();
      sentMessages.length = 0;
      channels.clear();
      guilds.clear();
      mock.login.reset();
      mock.destroy.reset();
    }
  };

  return mock;
}

/**
 * Create a mock Discord reaction event
 */
export function createReactionMock(options = {}) {
  const defaultEmoji = {
    name: '🎵',
    id: null
  };

  const defaultMessage = createMessageMock(options.message || {});
  
  const defaultUser = {
    id: 'U123USER',
    username: 'testuser',
    bot: false
  };

  return {
    emoji: options.emoji || defaultEmoji,
    message: options.message || defaultMessage,
    users: {
      cache: new Map([[options.user?.id || 'U123USER', options.user || defaultUser]]),
      fetch: sinon.stub().resolves()
    },
    count: options.count || 1,
    
    // The user who added the reaction
    _user: options.user || defaultUser
  };
}

/**
 * Create a complete Discord system mock for integration testing
 */
export function createDiscordSystemMock(options = {}) {
  const client = createDiscordClientMock(options);
  
  return {
    client,
    
    // Simulate incoming message
    simulateMessage: async function(content, channelId, user, roles = []) {
      const channel = {
        id: channelId,
        name: 'music',
        send: sinon.stub().resolves({ id: 'M123SENT' })
      };
      
      client._addChannel(channelId, channel);
      
      const message = createMessageMock({
        content,
        author: user || { id: 'U123USER', username: 'testuser', bot: false },
        channel,
        roles: roles.map((name, idx) => [`R${idx}`, { id: `R${idx}`, name }])
      });
      
      await client._emit('messageCreate', message);
      return message;
    },
    
    // Simulate reaction add
    simulateReaction: async function(emoji, message, user) {
      const reaction = createReactionMock({
        emoji: typeof emoji === 'string' ? { name: emoji, id: null } : emoji,
        message,
        user
      });
      
      await client._emit('messageReactionAdd', reaction, user);
      return reaction;
    },
    
    // Simulate bot ready event
    simulateReady: async function() {
      await client._emit('ready', client);
    },
    
    _reset: function() {
      client._reset();
    }
  };
}

export default { 
  createMessageMock, 
  createDiscordClientMock, 
  createReactionMock,
  createDiscordSystemMock 
};
