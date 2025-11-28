# Kom igång med tester

## Snabbstart

1. **Installera dependencies** (inklusive sinon för mocking):
```bash
npm install
```

2. **Kör alla tester**:
```bash
npm test
```

Du bör se output från alla testfiler:
- ✅ `test.mjs` (befintlig numFormatter test)
- ✅ `voting.test.mjs` (voting system logik)
- ✅ `parser.test.mjs` (argument parser)
- ✅ `integration.test.mjs` (integration tester)

## Exempel på test output

```
  Voting System Logic
    Gong Vote Tracking
      ✓ should allow first gong from user
      ✓ should prevent duplicate gong from same user
      ✓ should trigger gong action when limit reached
      ✓ should not trigger gong action before limit

  Argument Parser
    Basic parsing
      ✓ should parse simple command
      ✓ should parse command with multiple words
    Quote handling
      ✓ should parse double-quoted strings
      ✓ should parse single-quoted strings

  50 passing (25ms)
```

## När du gör ändringar

**Innan du pushar kod**, kör testerna:

```bash
npm test
```

Om alla tester passerar ✅ = dina ändringar har inte brutit befintlig funktionalitet!

## Lägga till nya tester

När du lägger till ny funktionalitet, lägg till ett test först:

```javascript
// test/myfeature.test.mjs
import { expect } from 'chai';

describe('My New Feature', function() {
  it('should work correctly', function() {
    const result = myFunction();
    expect(result).to.equal('expected');
  });
});
```

Detta kallas **Test Driven Development (TDD)**.

## Vad testas?

✅ **Voting logik** - Gong/vote räknare, limits, immunity
✅ **Argument parsing** - Quote handling, edge cases  
✅ **Business logik** - Duplicates, state management, URI conversion
✅ **Config validation** - Number ranges, type checking
✅ **Blacklist hantering** - Add/remove/check users

## Vad testas INTE (än)?

❌ Faktiska Spotify API anrop
❌ Faktiska Sonos anrop  
❌ Slack meddelanden

→ Dessa kan mockas i framtiden med sinon!

## Fördelar

🚀 **Snabbt** - Testerna körs på < 1 sekund
🔒 **Säkert** - Upptäck bugs innan de når produktion
📚 **Dokumentation** - Visar hur koden ska fungera
♻️ **Refactoring** - Våga ändra kod, testerna berättar om något går sönder

## Tips

- Kör `npm test` innan varje commit
- Skriv test när du hittar en bug (regression test)
- Håll tester enkla och fokuserade
- Ett test = en assert (ungefär)

Lycka till! 🎉
