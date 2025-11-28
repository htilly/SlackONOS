# SlackONOS Tests

Detta är testsuiten för SlackONOS som testar kärnlogiken utan att behöva vara kopplad mot Spotify, Slack eller Sonos.

## Installation

Installera test-dependencies:

```bash
npm install
```

## Köra tester

Kör alla tester:

```bash
npm test
```

Kör specifikt testfil:

```bash
npx mocha test/voting.test.mjs
npx mocha test/parser.test.mjs
npx mocha test/integration.test.mjs
```

Kör med watch mode (automatisk re-run vid ändringar):

```bash
npx mocha --watch test/**/*.test.mjs
```

## Test-struktur

### `test.mjs` (befintlig)
- Testar `numFormatter` utility-funktionen
- Grundläggande enhetstester

### `voting.test.mjs` ⭐ NYTT
Testar voting-systemets logik utan externa beroenden:
- **Gong Vote Tracking**: Verifierar att användare kan gonga, förhindra duplicerade gongs, trigger vid limit
- **Track Vote Tracking**: Räknar röster, förhindrar duplicate votes, promoverar tracks vid limit
- **Gong Immunity System**: Skyddar tracks från gong, håller koll på bannande
- **Flush Vote System**: Demokratisk rösning för att rensa kön

### `parser.test.mjs` ⭐ NYTT
Testar argument-parsern:
- Grundläggande parsing av kommandon
- Quote-hantering (dubbel och enkel)
- Edge cases (tomma strängar, null, spaces)
- Mixed quotes och plain text

### `integration.test.mjs` ⭐ NYTT
Högre nivå tester av affärslogik:
- **Track Duplicate Detection**: URI och name/artist matching
- **Player State Logic**: När ska queue flushes, auto-play
- **Spotify URI Conversion**: HTTP links → Spotify URIs
- **Vote Time Limit Logic**: Expiring votes över tid
- **Queue Position Calculation**: Konvertering mellan user input och Sonos positions
- **Blacklist Management**: Lägg till/ta bort/check users
- **Config Validation**: Nummer-ranges, type checking

## Fördelar med denna struktur

✅ **Inga externa beroenden**: Tester körs utan Spotify/Slack/Sonos
✅ **Snabb feedback**: Kör på sekunder, inte minuter
✅ **Regression testing**: Upptäck när ändringar sönder befintlig funktionalitet
✅ **Dokumentation**: Testerna visar hur systemet ska fungera
✅ **CI/CD ready**: Kan köras i GitHub Actions, Jenkins, etc.

## Nästa steg: Mocka externa dependencies

För att testa mer komplex logik kan man använda **sinon** för att mocka Spotify/Sonos:

```javascript
import sinon from 'sinon';

describe('Add command with mocked Sonos', function() {
  let sonosStub;
  
  beforeEach(function() {
    sonosStub = {
      getCurrentState: sinon.stub().resolves('stopped'),
      flush: sinon.stub().resolves(),
      queue: sinon.stub().resolves(),
      play: sinon.stub().resolves()
    };
  });
  
  it('should flush queue when stopped', async function() {
    await sonosStub.getCurrentState();
    await sonosStub.flush();
    
    expect(sonosStub.flush.calledOnce).to.be.true;
  });
});
```

## 📸 Spela in Spotify-svar (Snapshot Testing)

### Vad är det?
Istället för att mocka Spotify kan du **spela in riktiga API-svar** en gång och sedan använda dem i tester. Detta kallas "snapshot testing" eller "fixture-based testing".

### Hur det fungerar:

1. **Spela in svar** (kräver Spotify credentials):
```bash
npm run test:record
```

Detta kör skriptet `test/tools/record-spotify-responses.mjs` som:
- Gör riktiga Spotify API-anrop
- Sparar svaren till `test/fixtures/spotify-responses.json`
- Du behöver bara göra detta en gång (eller när du vill uppdatera)

2. **Använd i tester** (inga credentials behövs):
```bash
npm test
```

Testerna i `test/spotify.test.mjs` läser från fixtures och verifierar:
- ✅ Att Spotify-svar parsas korrekt
- ✅ Att "bestof" sorterar efter popularity
- ✅ Att album/playlist formateras rätt
- ✅ Att URI:er är giltiga

### Fördelar:

✅ **Snabbt** - Inga API-anrop under tester  
✅ **Reproducerbart** - Samma resultat varje gång  
✅ **Offline** - Fungerar utan internet  
✅ **CI-friendly** - GitHub Actions behöver inga Spotify credentials  
✅ **Realistiskt** - Använder riktiga data från Spotify

### Lägg till fler test-cases:

Editera `test/tools/record-spotify-responses.mjs` och lägg till:

```javascript
fixtures.searchTrack.my_new_test = await spotify.getTrack('test query');
```

Kör sedan:
```bash
npm run test:record
```

### Fixture-filen:

`test/fixtures/spotify-responses.json` innehåller:
- `searchTrack` - Individuella låtsökningar
- `searchTrackList` - Listor för "bestof" kommandot
- `searchAlbum` - Albumsökningar
- `searchPlaylist` - Playlistsökningar
- `getAlbum` - Album med cover art
- `getPlaylist` - Playlists med owner info

## Tips för att skriva nya tester

1. **Isolera logiken**: Bryt ut ren logik från I/O-operationer
2. **Test en sak i taget**: Varje test ska verifiera EN beteende
3. **Använd beskrivande namn**: "should allow first gong from user"
4. **Setup/Teardown**: Använd `beforeEach`/`afterEach` för att resetta state
5. **Mock externa anrop**: Använd sinon för Spotify/Sonos/Slack anrop

## Coverage (framtida förbättring)

Lägg till test coverage reporting:

```bash
npm install --save-dev c8
```

Uppdatera `package.json`:
```json
{
  "scripts": {
    "test": "NODE_ENV=test mocha --reporter spec",
    "test:coverage": "c8 npm test"
  }
}
```

Kör med coverage:
```bash
npm run test:coverage
```
