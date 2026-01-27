# Implementation Plan: Add `fr` alias for `featurerequest` command

## 1. Implementation Plan

This is a simple alias addition. The bot likely has a command routing system that needs to recognize `fr` as an alternative to `featurerequest`. Based on the codebase structure, we need to:

1. Locate where the `featurerequest` command is handled
2. Add `fr` as an alias in the command routing logic
3. Update help text to mention the new alias

Since I don't see the full command routing logic in the provided files, I'll need to check `index.js` where commands are likely parsed and routed.

## 2. Files to Modify

Based on the typical structure, these files likely need updates:

1. **`index.js`** - Main command routing logic (where `featurerequest` is handled)
2. **`templates/help/helpText.txt`** - User help text (if it mentions featurerequest)
3. **`templates/help/helpTextAdmin.txt`** - Admin help text (if applicable)

## 3. Code Changes

### File: `index.js`

**Location:** Find the section where `featurerequest` command is handled. It's likely in a command parsing section (look for a switch statement or if/else chain checking command names).

**Find code that looks like this:**
```javascript
if (command === 'featurerequest') {
    // feature request handling code
}
```

**Replace with:**
```javascript
if (command === 'featurerequest' || command === 'fr') {
    // feature request handling code
}
```

**OR if using a switch statement, find:**
```javascript
case 'featurerequest':
    // feature request handling code
    break;
```

**Replace with:**
```javascript
case 'featurerequest':
case 'fr':
    // feature request handling code
    break;
```

**OR if using a command map/object, find:**
```javascript
const commands = {
    'featurerequest': handleFeatureRequest,
    // other commands
};
```

**Replace with:**
```javascript
const commands = {
    'featurerequest': handleFeatureRequest,
    'fr': handleFeatureRequest, // Alias for featurerequest
    // other commands
};
```

---

### File: `templates/help/helpText.txt`

**Action:** Update the help text to mention the alias.

**Find:**
```
featurerequest <your suggestion> - Submit a feature request
```

**Replace with:**
```
featurerequest (or fr) <your suggestion> - Submit a feature request
```

---

### File: `templates/help/helpTextAdmin.txt`

**Action:** Same update if `featurerequest` is mentioned in admin help.

**Find:**
```
featurerequest <your suggestion> - Submit a feature request
```

**Replace with:**
```
featurerequest (or fr) <your suggestion> - Submit a feature request
```

---

## 4. Alternative: AI Handler Update (if featurerequest is AI-parsed)

If the `featurerequest` command is handled through the AI system (`lib/ai-handler.js`), you may need to update the AI prompt to recognize `fr` as well.

### File: `lib/ai-handler.js`

**Location:** Find the system prompt where commands are listed for the AI.

**Find section listing available commands (likely in a prompt template):**
```javascript
const systemPrompt = `
Available commands:
- featurerequest: Submit a feature request
...
`;
```

**Update to:**
```javascript
const systemPrompt = `
Available commands:
- featurerequest (or fr): Submit a feature request
...
`;
```

---

## 5. Testing Checklist

After implementing:

1. ✅ Test `featurerequest <message>` - should work as before
2. ✅ Test `fr <message>` - should work identically
3. ✅ Test `help` command - should show the alias
4. ✅ Check both Slack and Discord platforms
5. ✅ Verify AI parsing recognizes both variants (if applicable)

---

## 6. Complete Example (Most Likely Scenario)

Since I don't see the full command routing in the provided files, here's the most common pattern you'll find in `index.js`:

### In `index.js`, find the command parsing section:

```javascript
// Example of typical command routing pattern
const command = input.split(' ')[0].toLowerCase();
const args = input.substring(command.length).trim();

if (command === 'play') {
    commandHandlers.play(input, channel, userName);
} else if (command === 'pause') {
    commandHandlers.pause(input, channel, userName);
} else if (command === 'featurerequest') {
    // Handle feature request
    handleFeatureRequest(args, channel, userName);
}
```

### Update to:

```javascript
// Example of typical command routing pattern
const command = input.split(' ')[0].toLowerCase();
const args = input.substring(command.length).trim();

if (command === 'play') {
    commandHandlers.play(input, channel, userName);
} else if (command === 'pause') {
    commandHandlers.pause(input, channel, userName);
} else if (command === 'featurerequest' || command === 'fr') {
    // Handle feature request (fr is alias)
    handleFeatureRequest(args, channel, userName);
}
```

---

## Summary

This is a straightforward change requiring:
1. Adding `|| command === 'fr'` to the command check in `index.js`
2. Updating help text to mention the alias
3. Testing both commands work identically

The exact line numbers depend on the full `index.js` file structure, but the pattern above covers all common command routing approaches.