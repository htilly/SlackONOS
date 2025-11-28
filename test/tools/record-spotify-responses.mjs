#!/usr/bin/env node

/**
 * Record real Spotify API responses for testing
 * 
 * Usage:
 *   node test/tools/record-spotify-responses.mjs
 * 
 * This will make real Spotify API calls and save responses to fixtures
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import your spotify module
// Note: You may need to adjust this path
const spotifyModule = await import('../../spotify-async.js');
const spotify = spotifyModule.default;

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
    fixtures.searchTrack.smells_like_teen_spirit = await spotify.getTrack('smells like teen spirit');
    console.log('✅ Track searches recorded');

    // Record track lists for bestof
    console.log('📀 Recording track lists for bestof...');
    fixtures.searchTrackList.foo_fighters = await spotify.searchTrackList('foo fighters', 10);
    fixtures.searchTrackList.queen = await spotify.searchTrackList('queen', 10);
    fixtures.searchTrackList.nirvana = await spotify.searchTrackList('nirvana', 10);
    console.log('✅ Track lists recorded');

    // Record album searches
    console.log('💿 Recording album searches...');
    fixtures.searchAlbum.dark_side_of_the_moon = await spotify.searchAlbum('dark side of the moon');
    fixtures.searchAlbum.nevermind = await spotify.searchAlbum('nevermind nirvana');
    console.log('✅ Album searches recorded');

    // Record album gets
    console.log('💿 Recording album gets...');
    fixtures.getAlbum.nevermind = await spotify.getAlbum('nevermind');
    fixtures.getAlbum.dark_side = await spotify.getAlbum('dark side of the moon');
    console.log('✅ Album gets recorded');

    // Record playlist searches
    console.log('📋 Recording playlist searches...');
    fixtures.searchPlaylist.rock_classics = await spotify.searchPlaylist('rock classics');
    fixtures.searchPlaylist.chill_hits = await spotify.searchPlaylist('chill hits');
    console.log('✅ Playlist searches recorded');

    // Record playlist gets
    console.log('📋 Recording playlist gets...');
    fixtures.getPlaylist.rock_classics = await spotify.getPlaylist('rock classics');
    fixtures.getPlaylist.chill_hits = await spotify.getPlaylist('chill hits');
    console.log('✅ Playlist gets recorded');

    // Save to file
    console.log('\n💾 Saving fixtures to file...');
    const json = JSON.stringify(fixtures, null, 2);
    fs.writeFileSync(fixturesPath, json, 'utf-8');
    console.log(`✅ Fixtures saved to ${fixturesPath}`);

    console.log('\n🎉 All Spotify responses recorded successfully!');
    console.log('You can now run tests with: npm test');

  } catch (error) {
    console.error('❌ Error recording responses:', error.message);
    process.exit(1);
  }
}

// Run it
recordResponses();
