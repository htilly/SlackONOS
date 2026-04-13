import { expect } from 'chai';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * Help Text Template Tests (SLAC-9)
 *
 * Verifies that:
 *  1. The featurerequest command description reads exactly:
 *     "Wish for what new feature this bot should have!!!"
 *  2. No other command descriptions were altered as a side effect.
 *  3. All expected command sections and entries are present.
 *  4. Handlebars-style placeholders used by both Slack and Discord are intact.
 *  5. The file can be read without errors (bot can start).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HELP_TEXT_PATH = join(__dirname, '..', 'templates', 'help', 'helpText.txt');

// Read once for all tests
let helpText;
try {
  helpText = readFileSync(HELP_TEXT_PATH, 'utf8');
} catch (err) {
  helpText = null;
}

// ─── SLAC-9: featurerequest description ──────────────────────────────────────

describe('helpText.txt — SLAC-9: featurerequest description', function () {

  it('should be readable without errors', function () {
    expect(helpText).to.be.a('string');
    expect(helpText.length).to.be.greaterThan(0);
  });

  it('should contain the exact new featurerequest description text', function () {
    expect(helpText).to.include('Wish for what new feature this bot should have!!!');
  });

  it('should NOT contain the old featurerequest description text', function () {
    expect(helpText).to.not.include('Create a GitHub issue for a feature request.');
  });

  it('should list featurerequest command with its "fr" alias', function () {
    expect(helpText).to.match(/`featurerequest`\s*\(or\s*`fr`\)/);
  });

  it('should include the feature description argument placeholder', function () {
    expect(helpText).to.include('<feature description>');
  });

  it('should have the featurerequest entry in the Feedback section', function () {
    const feedbackSectionStart = helpText.indexOf('*📝 Feedback:*');
    expect(feedbackSectionStart).to.be.greaterThan(-1, 'Feedback section header not found');

    const featureRequestIndex = helpText.indexOf('featurerequest', feedbackSectionStart);
    expect(featureRequestIndex).to.be.greaterThan(
      feedbackSectionStart,
      'featurerequest entry should appear after the Feedback section header'
    );
  });

  it('should have the new description on the same line as the featurerequest command entry', function () {
    const lines = helpText.split('\n');
    const featureRequestLine = lines.find(line => line.includes('featurerequest') && line.includes('fr'));
    expect(featureRequestLine).to.be.a('string', 'Could not find the featurerequest command line');
    expect(featureRequestLine).to.include('Wish for what new feature this bot should have!!!');
  });

  it('should have exactly one featurerequest entry', function () {
    const matches = helpText.match(/`featurerequest`/g);
    expect(matches).to.not.be.null;
    expect(matches.length).to.equal(1);
  });
});

// ─── Section headers ─────────────────────────────────────────────────────────

describe('helpText.txt — Section headers are intact', function () {

  it('should contain the Music Commands section header', function () {
    expect(helpText).to.include('*🎵 Music Commands:*');
  });

  it('should contain the Info Commands section header', function () {
    expect(helpText).to.include('*ℹ️ Info Commands:*');
  });

  it('should contain the Voting Commands section header', function () {
    expect(helpText).to.include('*🗳️ Voting Commands:*');
  });

  it('should contain the Feedback section header', function () {
    expect(helpText).to.include('*📝 Feedback:*');
  });
});

// ─── Music commands unchanged ─────────────────────────────────────────────────

describe('helpText.txt — Music command descriptions are unchanged', function () {

  it('should contain the add command description', function () {
    expect(helpText).to.include('`add [track]`');
    expect(helpText).to.include('Add a track (search term, Spotify URI, or link). When stopped, starts a fresh queue.');
  });

  it('should contain the append command description', function () {
    expect(helpText).to.include('`append [track]`');
    expect(helpText).to.include('Add a track (search term, Spotify URI, or link) without clearing the queue.');
  });

  it('should contain the addalbum command description', function () {
    expect(helpText).to.include('`addalbum [album]`');
    expect(helpText).to.include('Add an entire album (search term, Spotify URI, or link) to the queue.');
  });

  it('should contain the addplaylist command description', function () {
    expect(helpText).to.include('`addplaylist [playlist]`');
    expect(helpText).to.include('Add an entire playlist (search term, Spotify URI, or link) to the queue.');
  });

  it('should contain the search command description with searchLimit placeholder', function () {
    expect(helpText).to.include('`search [track]`');
    expect(helpText).to.include('{{searchLimit}}');
  });

  it('should contain the searchalbum command description', function () {
    expect(helpText).to.include('`searchalbum [album]`');
    expect(helpText).to.include('Search for an album on Spotify.');
  });

  it('should contain the searchplaylist command description', function () {
    expect(helpText).to.include('`searchplaylist [playlist]`');
    expect(helpText).to.include('Search for a playlist on Spotify.');
  });
});

// ─── Info commands unchanged ──────────────────────────────────────────────────

describe('helpText.txt — Info command descriptions are unchanged', function () {

  it('should contain the current / wtf command description', function () {
    expect(helpText).to.include('`current` (or `wtf`)');
    expect(helpText).to.include("Show what's currently playing.");
  });

  it('should contain the list / ls / playlist command description', function () {
    expect(helpText).to.include('`list` (or `ls`, `playlist`)');
    expect(helpText).to.include('Show the entire queue.');
  });

  it('should contain the upnext command description', function () {
    expect(helpText).to.include('`upnext`');
    expect(helpText).to.include('Show the next 5 tracks.');
  });

  it('should contain the size / count command description', function () {
    expect(helpText).to.include('`size` (or `count`)');
    expect(helpText).to.include('Get the number of songs in the queue.');
  });

  it('should contain the volume command description', function () {
    expect(helpText).to.include('`volume`');
    expect(helpText).to.include('Get the current volume level.');
  });

  it('should contain the status command description', function () {
    expect(helpText).to.include('`status`');
    expect(helpText).to.include('Get the current playback status.');
  });

  it('should contain the bestof command description', function () {
    expect(helpText).to.include('`bestof [user]`');
    expect(helpText).to.include('Show the top tracks added by a user.');
  });
});

// ─── Voting commands unchanged ────────────────────────────────────────────────

describe('helpText.txt — Voting command descriptions are unchanged', function () {

  it('should contain the gong / dong command description with gongLimit placeholder', function () {
    expect(helpText).to.include('`gong` (or `dong`)');
    expect(helpText).to.include('Vote to skip the current track. Needs *{{gongLimit}}* votes.');
  });

  it('should contain the gongcheck command description', function () {
    expect(helpText).to.include('`gongcheck`');
    expect(helpText).to.include('Check how many GONG votes are remaining.');
  });

  it('should contain the voteimmune command description with voteImmuneLimit placeholder', function () {
    expect(helpText).to.include('`voteimmune [position]`');
    expect(helpText).to.include('Protect a track from being gonged. Needs *{{voteImmuneLimit}}* votes.');
  });

  it('should contain the voteimmunecheck command description', function () {
    expect(helpText).to.include('`voteimmunecheck`');
    expect(helpText).to.include('Check vote immune status.');
  });

  it('should contain the vote command description with voteLimit placeholder', function () {
    expect(helpText).to.include('`vote [position]`');
    expect(helpText).to.include('Move a track to the top. Needs *{{voteLimit}}* votes.');
  });

  it('should contain the votecheck command description', function () {
    expect(helpText).to.include('`votecheck`');
    expect(helpText).to.include('Check the current vote counts.');
  });

  it('should contain the flushvote command description with flushVoteLimit and voteTimeLimitMinutes placeholders', function () {
    expect(helpText).to.include('`flushvote`');
    expect(helpText).to.include('Vote to clear the entire queue. Needs *{{flushVoteLimit}}* votes within *{{voteTimeLimitMinutes}}* min.');
  });
});

// ─── Handlebars placeholders (shared Slack + Discord rendering) ───────────────

describe('helpText.txt — Template placeholders for Slack and Discord are intact', function () {

  it('should contain the {{searchLimit}} placeholder', function () {
    expect(helpText).to.include('{{searchLimit}}');
  });

  it('should contain the {{gongLimit}} placeholder', function () {
    expect(helpText).to.include('{{gongLimit}}');
  });

  it('should contain the {{voteImmuneLimit}} placeholder', function () {
    expect(helpText).to.include('{{voteImmuneLimit}}');
  });

  it('should contain the {{voteLimit}} placeholder', function () {
    expect(helpText).to.include('{{voteLimit}}');
  });

  it('should contain the {{flushVoteLimit}} placeholder', function () {
    expect(helpText).to.include('{{flushVoteLimit}}');
  });

  it('should contain the {{voteTimeLimitMinutes}} placeholder', function () {
    expect(helpText).to.include('{{voteTimeLimitMinutes}}');
  });
});

// ─── Footer / tip lines unchanged ────────────────────────────────────────────

describe('helpText.txt — Footer and tip lines are unchanged', function () {

  it('should contain the Spotify URI tip line', function () {
    expect(helpText).to.include(
      'Tip: You can use Spotify URIs (spotify:track:...) OR paste Spotify links (https://open.spotify.com/...)'
    );
  });

  it('should contain the GitHub link in the footer', function () {
    expect(helpText).to.include('https://github.com/htilly/SlackONOS');
  });

  it('should contain the suggestions/bugs footer line', function () {
    expect(helpText).to.include('Suggestions or bugs?');
  });
});

// ─── Structural / ordering checks ────────────────────────────────────────────

describe('helpText.txt — Section ordering is correct', function () {

  it('should have Music Commands before Info Commands', function () {
    const musicIdx = helpText.indexOf('*🎵 Music Commands:*');
    const infoIdx = helpText.indexOf('*ℹ️ Info Commands:*');
    expect(musicIdx).to.be.greaterThan(-1);
    expect(infoIdx).to.be.greaterThan(-1);
    expect(musicIdx).to.be.lessThan(infoIdx);
  });

  it('should have Info Commands before Voting Commands', function () {
    const infoIdx = helpText.indexOf('*ℹ️ Info Commands:*');
    const votingIdx = helpText.indexOf('*🗳️ Voting Commands:*');
    expect(infoIdx).to.be.greaterThan(-1);
    expect(votingIdx).to.be.greaterThan(-1);
    expect(infoIdx).to.be.lessThan(votingIdx);
  });

  it('should have Voting Commands before Feedback section', function () {
    const votingIdx = helpText.indexOf('*🗳️ Voting Commands:*');
    const feedbackIdx = helpText.indexOf('*📝 Feedback:*');
    expect(votingIdx).to.be.greaterThan(-1);
    expect(feedbackIdx).to.be.greaterThan(-1);
    expect(votingIdx).to.be.lessThan(feedbackIdx);
  });

  it('should have the featurerequest entry after the Feedback section header and before the footer tip', function () {
    const feedbackIdx = helpText.indexOf('*📝 Feedback:*');
    const featureRequestIdx = helpText.indexOf('featurerequest');
    const tipIdx = helpText.indexOf('_Tip:');
    expect(feedbackIdx).to.be.greaterThan(-1);
    expect(featureRequestIdx).to.be.greaterThan(feedbackIdx);
    expect(featureRequestIdx).to.be.lessThan(tipIdx);
  });
});
