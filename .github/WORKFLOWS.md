# GitHub Actions för SlackONOS

Detta repo har två GitHub Actions workflows som automatiskt körs vid code changes.

## 🔍 Workflows

### 1. `test.yml` - Run Tests
**Körs vid:** Push eller Pull Request till `master`, `main`, eller `develop`

**Vad den gör:**
- ✅ Testar mot Node.js 18.x, 20.x, och 22.x
- ✅ Installerar dependencies
- ✅ Skapar config fil från example
- ✅ Kör alla tester med `npm test`
- ✅ Laddar upp test results som artifacts

**Matrix testing:** Säkerställer att koden fungerar på flera Node-versioner!

### 2. `coverage.yml` - Test and Coverage
**Körs vid:** Push eller Pull Request till `master` eller `main`

**Vad den gör:**
- ✅ Kör tester med code coverage (c8)
- ✅ Genererar coverage report
- ✅ Visar coverage summary
- ✅ (Valfritt) Laddar upp till Codecov för visualisering

## 📊 Se resultat

### I GitHub:
1. Gå till din repo på GitHub
2. Klicka på "Actions" fliken
3. Se status på alla test-körningar

### Pull Requests:
- ✅ Grön check = Alla tester passerar
- ❌ Röd X = Någon test failar

GitHub blockerar merge om testerna failar! (kan konfigureras)

## 🎯 Status Badge

Lägg till en status badge i din README.md:

```markdown
![Tests](https://github.com/htilly/SlackONOS/workflows/Run%20Tests/badge.svg)
![Coverage](https://github.com/htilly/SlackONOS/workflows/Test%20and%20Coverage/badge.svg)
```

Detta visar live status från senaste test-körningen! ✨

## 🔧 Konfigurera Branch Protection

För att kräva att tester passerar innan merge:

1. Gå till Settings → Branches
2. Lägg till rule för `master` branch
3. Aktivera "Require status checks to pass before merging"
4. Välj "test" workflow
5. Spara

Nu kan ingen merga kod som failar tester! 🛡️

## 📈 Codecov Integration (Valfritt)

För att visualisera code coverage:

1. Gå till [codecov.io](https://codecov.io)
2. Logga in med GitHub
3. Aktivera repo: `htilly/SlackONOS`
4. Få token och lägg till som GitHub Secret: `CODECOV_TOKEN`
5. Uppdatera `coverage.yml` med token

Nu får du snygga coverage reports och graphs! 📊

## 🚀 Lokal utveckling

Testerna körs automatiskt i GitHub, men du kan också köra dem lokalt:

```bash
# Vanliga tester
npm test

# Med coverage
npx c8 npm test
```

## 🔄 Workflow triggers

**Automatiska triggers:**
- `git push` till master/main/develop
- Pull Request mot master/main/develop
- Manuell trigger via GitHub Actions UI

**Hoppa över tester:**
Om du vill hoppa över CI (t.ex. för README-ändringar):
```bash
git commit -m "Update README [skip ci]"
```

## 📝 Anpassa workflows

### Ändra vilka branches som testas:
```yaml
on:
  push:
    branches: [ master, feature/* ]  # Lägg till fler branches
```

### Lägg till fler Node-versioner:
```yaml
strategy:
  matrix:
    node-version: [18.x, 20.x, 22.x, 24.x]  # Lägg till nya versioner
```

### Lägg till OS-matrix (testa på Windows/Mac):
```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    node-version: [20.x]
runs-on: ${{ matrix.os }}
```

## 🎉 Fördelar

✅ **Automatisk testning** - Ingen manuell process
✅ **Multi-version** - Testar på flera Node-versioner
✅ **Pull Request checks** - Se status innan merge
✅ **Coverage tracking** - Håll koll på test coverage
✅ **Fast feedback** - Få reda på problem direkt

Testa att pusha kod nu och se workflows köra! 🚀
