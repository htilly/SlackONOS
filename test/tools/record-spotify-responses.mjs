#!/usr/bin/env node

/**
 * Record real Spotify API responses for testing
 * 
 * Usage:
 *   npm run test:record
 * 
 * This will make real Spotify API calls and save responses to fixtures
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load config
const nconf = require('nconf');
nconf.file({ file: 'config/config.json' });

const spotifyConfig = {
  clientId: nconf.get('spotifyClientId'),
  clientSecret: nconf.get('spotifyClientSecret'),
  market: nconf.get('market') || 'US'
};

// Verify credentials are loaded
if (!spotifyConfig.clientId || !spotifyConfig.clientSecret) {
  console.error('❌ Missing Spotify credentials in config/config.json');
  console.error('   Please set spotifyClientId and spotifyClientSecret');
  process.exit(1);
}

console.log('✅ Spotify credentials loaded');
console.log(`   Market: ${spotifyConfig.market}`);
console.log(`   Client ID: ${spotifyConfig.clientId.substring(0, 10)}...`);
console.log('');

// Import Spotify module (CommonJS)
const spotifyFactory = require('../../spotify-async.js');
const spotify = spotifyFactory(spotifyConfig);

const fixturesPath = path.join(__dirname, '../fixtures/spotify-responses.json');

async function recordResponses() {
  console.log('🎵 Recording Spotify API responses...\n');
  
  const fixtures = {
    searchTrack: {},
    searchTrackList: {},
    searchAlbum: {},
    searchPlaylist: {},
    getAlbum: {},
    getPlaylist: {}
  };

  try {
    // Record track searches
    console.log('📀 Recording track searches...');
    fixtures.searchTrack.bohemian_rhapsody = await spotify.getTrack('bohemian rhapsody queen');
    console.log('  ✅ Bohemian Rhapsody');
    
    fixtures.searchTrack.smells_like_teen_spirit = await spotify.getTrack('smells like teen spirit');
    console.log('  ✅ Smells Like Teen Spirit');
    
    fixtures.searchTrack.everlong = await spotify.getTrack('everlong foo fighters');
    console.log('  ✅ Everlong');

    // Record track lists for bestof
    console.log('\n📀 Recording track lists for bestof...');
    fixtures.searchTrackList.foo_fighters = await spotify.searchTrackList('foo fighters', 10);
    console.log('  ✅ Foo Fighters (' + fixtures.searchTrackList.foo_fighters.length + ' tracks)');
    
    fixtures.searchTrackList.queen = await spotify.searchTrackList('queen', 10);
    console.log('  ✅ Queen (' + fixtures.searchTrackList.queen.length + ' tracks)');
    
    fixtures.searchTrackList.nirvana = await spotify.searchTrackList('nirvana', 10);
    console.log('  ✅ Nirvana (' + fixtures.searchTrackList.nirvana.length + ' tracks)');

    // Record album searches (using searchAlbumList)
    console.log('\n💿 Recording album searches...');
    const darkSideResults = await spotify.searchAlbumList('dark side of the moon', 1);
    fixtures.searchAlbum.dark_side_of_the_moon = darkSideResults[0];
    console.log('  ✅ Dark Side of the Moon');
    
    const nevermindResults = await spotify.searchAlbumList('nevermind nirvana', 1);
    fixtures.searchAlbum.nevermind = nevermindResults[0];
    console.log('  ✅ Nevermind');

    // Record album gets
    console.log('\n💿 Recording album gets...');
    fixtures.getAlbum.nevermind = await spotify.getAlbum('nevermind');
    console.log('  ✅ Nevermind (with cover)');
    
    fixtures.getAlbum.dark_side = await spotify.getAlbum('dark side of the moon');
    console.log('  ✅ Dark Side of the Moon (with cover)');

    // Record playlist searches
    console.log('\n📋 Recording playlist searches...');
    fixtures.searchPlaylist.rock_classics = await spotify.searchPlaylistList('rock classics', 3);
    console.log('  ✅ Rock Classics (' + fixtures.searchPlaylist.rock_classics.length + ' playlists)');
    
    fixtures.searchPlaylist.chill_hits = await spotify.searchPlaylistList('chill hits', 3);
    console.log('  ✅ Chill Hits (' + fixtures.searchPlaylist.chill_hits.length + ' playlists)');

    // Record playlist gets (use URIs from search results)
    console.log('\n📋 Recording playlist gets...');
    if (fixtures.searchPlaylist.rock_classics.length > 0) {
      const rockUri = fixtures.searchPlaylist.rock_classics[0].uri;
      fixtures.getPlaylist.rock_classics = await spotify.getPlaylist(rockUri);
      console.log('  ✅ Rock Classics (full details)');
    }
    
    if (fixtures.searchPlaylist.chill_hits.length > 0) {
      const chillUri = fixtures.searchPlaylist.chill_hits[0].uri;
      fixtures.getPlaylist.chill_hits = await spotify.getPlaylist(chillUri);
      console.log('  ✅ Chill Hits (full details)');
    }

    // Save to file
    console.log('\n💾 Saving fixtures to file...');
    const json = JSON.stringify(fixtures, null, 2);
    fs.writeFileSync(fixturesPath, json, 'utf-8');
    console.log(`✅ Fixtures saved to ${fixturesPath}`);

    console.log('\n🎉 All Spotify responses recorded successfully!');
    console.log('\n📊 Summary:');
    console.log(`  - ${Object.keys(fixtures.searchTrack).length} track searches`);
    console.log(`  - ${Object.keys(fixtures.searchTrackList).length} track lists (bestof)`);
    console.log(`  - ${Object.keys(fixtures.searchAlbum).length} album searches`);
    console.log(`  - ${Object.keys(fixtures.getAlbum).length} album gets`);
    console.log(`  - ${Object.keys(fixtures.searchPlaylist).length} playlist searches`);
    console.log(`  - ${Object.keys(fixtures.getPlaylist).length} playlist gets`);
    console.log('\nYou can now run tests with: npm test');

  } catch (error) {
    console.error('\n❌ Error recording responses:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run it
recordResponses();
