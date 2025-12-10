
# Getting Started with Testing


## Quick Start

1. **Install dependencies** (including sinon for mocking):
```bash
npm install
```

2. **Run all tests**:
```bash
npm test
```


You should see output from all test files:
- ✅ `test.mjs` (existing numFormatter test)
- ✅ `voting.test.mjs` (voting system logic)
- ✅ `parser.test.mjs` (argument parser)
- ✅ `integration.test.mjs` (integration tests)


## Example Test Output

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

![Test Output Screenshot](images/Screenshot%20Testing.png)
*Example of test output in the terminal showing all passing tests*


## When Making Changes


**Before you push code**, run the tests:

```bash
npm test
```


If all tests pass ✅, your changes have not broken existing functionality!


## Adding New Tests


When you add new functionality, add a test first:

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


This is called **Test Driven Development (TDD)**.


## What is Tested?


✅ **Voting logic** - Gong/vote counters, limits, immunity
✅ **Argument parsing** - Quote handling, edge cases
✅ **Business logic** - Duplicates, state management, URI conversion
✅ **Config validation** - Number ranges, type checking
✅ **Blacklist handling** - Add/remove/check users


## What is NOT Tested (yet)?


❌ Actual Spotify API calls
❌ Actual Sonos calls
❌ Slack messages


→ These can be mocked in the future with sinon!


## Benefits


🚀 **Fast** - Tests run in under 1 second
🔒 **Safe** - Catch bugs before they reach production
📚 **Documentation** - Shows how the code should work
♻️ **Refactoring** - Change code confidently, tests will tell you if something breaks


## Tips


- Run `npm test` before every commit
- Write a test when you find a bug (regression test)
- Keep tests simple and focused
- One test = one assert (roughly)

Good luck! 🎉
