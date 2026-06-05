# GitHub Actions for SlackONOS

This repo has GitHub Actions workflows that automatically run tests, coverage, release publishing, and feature-request automation.

## 🔍 Workflows

### 1. `test.yml` - Run Tests
**Runs on:** Push or Pull Request to `master` or `main`

**What it does:**
- ✅ Tests against Node.js 22.x, 24.x, and 26.x
- ✅ Installs dependencies
- ✅ Creates config file from example
- ✅ Runs all tests with `npm test`
- ✅ Uses recorded Spotify responses (no API calls during tests)
- ✅ Uploads test results as artifacts

**Matrix testing:** Ensures the code works on multiple Node versions!

**Offline testing:** Tests use pre-recorded Spotify API responses from `test/fixtures/spotify-responses.json`, so no live API credentials are needed during CI runs.

### 2. `coverage.yml` - Test and Coverage
**Runs on:** Push or Pull Request to `master` or `main`

**What it does:**
- ✅ Runs tests with code coverage (c8)
- ✅ Generates coverage report
- ✅ Shows coverage summary
- ✅ (Optional) Uploads to Codecov for visualization

## 📊 View Results

### In GitHub:
1. Go to your repo on GitHub
2. Click the "Actions" tab
3. See status of all test runs

### Pull Requests:
- ✅ Green check = All tests pass
- ❌ Red X = Some tests fail

GitHub blocks merge if tests fail! (can be configured)

## 🎯 Status Badge

Add a status badge to your README.md:

```markdown
![Tests](https://github.com/htilly/SlackONOS/workflows/Run%20Tests/badge.svg)
![Coverage](https://github.com/htilly/SlackONOS/workflows/Test%20and%20Coverage/badge.svg)
```

This shows live status from the latest test run! ✨

## 🔧 Configure Branch Protection

To require tests to pass before merge:

1. Go to Settings → Branches
2. Add rule for `master` branch
3. Enable "Require status checks to pass before merging"
4. Select "test" workflow
5. Save

Now no one can merge code that fails tests! 🛡️

## 📈 Codecov Integration (Optional)

To visualize code coverage:

1. Go to [codecov.io](https://codecov.io)
2. Log in with GitHub
3. Enable repo: `htilly/SlackONOS`
4. Get token and add as GitHub Secret: `CODECOV_TOKEN`
5. Update `coverage.yml` with token

Now you get nice coverage reports and graphs! 📊

## 🚀 Local Development

Tests run automatically in GitHub, but you can also run them locally:

```bash
# Regular tests (uses recorded Spotify fixtures)
npm test

# With coverage
npx c8 npm test

# Record new Spotify API responses (requires real credentials)
npm run test:record
```

**Note:** The test suite uses pre-recorded Spotify API responses stored in `test/fixtures/spotify-responses.json`. This allows tests to run without real API credentials and ensures consistent results. To update the fixtures with fresh data, use `npm run test:record` with valid Spotify credentials configured.

## 🔄 Workflow Triggers

**Automatic triggers:**
- `git push` to master/main
- Pull Request against master/main
- Manual trigger via GitHub Actions UI

**Skip tests:**
If you want to skip CI (e.g., for README changes):
```bash
git commit -m "Update README [skip ci]"
```

## 📝 Customize Workflows

### Change which branches are tested:
```yaml
on:
  push:
    branches: [ master, feature/* ]  # Add more branches
```

### Add more Node versions:
```yaml
strategy:
  matrix:
    node-version: [18.x, 20.x, 22.x, 24.x]  # Add new versions
```

### Add OS matrix (test on Windows/Mac):
```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    node-version: [20.x]
runs-on: ${{ matrix.os }}
```

## 🎉 Benefits

✅ **Automatic testing** - No manual process
✅ **Multi-version** - Tests on multiple Node versions
✅ **Pull Request checks** - See status before merge
✅ **Coverage tracking** - Keep track of test coverage
✅ **Fast feedback** - Find out about problems immediately

Try pushing code now and watch the workflows run! 🚀
