# Implementation Plan

## Overview
Add `fr` as an alias for the `featurerequest` command so users can type either `featurerequest` or `fr` to submit feature requests.

## Analysis
Based on the project structure, the command routing happens in `index.js` where commands are parsed and dispatched. The feature request functionality is handled by the `githubApp` module (`lib/github-app.js`). We need to:

1. Add `fr` as an alias in the command parsing logic
2. Ensure both `featurerequest` and `fr` trigger the same handler

## Files to Modify

1. **`index.js`** - Main command routing logic (where commands are parsed and dispatched)

## Code Changes

### 1. Modify `index.js`

Find the section where commands are parsed and the `featurerequest` command is handled. You need to add `fr` as an alias. 

**Look for code similar to this pattern:**

```javascript
// Search for where 'featurerequest' is handled
if (input.startsWith('featurerequest ')) {
  // handle feature request
}
```

**Add the alias check alongside it:**

```javascript
// Feature request command - supports both 'featurerequest' and 'fr' as aliases
if (input.startsWith('featurerequest ') || input.startsWith('fr ')) {
  const command = input.startsWith('featurerequest ') ? 'featurerequest' : 'fr';
  const requestText = input.substring(command.length + 1).trim(); // +1 for the space
  
  if (!requestText) {
    sendMessage('Please provide a feature request description. Usage: `featurerequest <description>` or `fr <description>`', channel);
    return;
  }
  
  // Pass to existing github app handler
  githubApp.handleFeatureRequest(requestText, userName, channel, sendMessage);
  return;
}
```

**Alternative approach if using a switch/case or command map:**

If the code uses a command map or switch statement, add the alias like this:

```javascript
// If there's a command map:
const commandAliases = {
  'fr': 'featurerequest',
  // ... other aliases
};

// Normalize command
let command = input.split(' ')[0].toLowerCase();
if (commandAliases[command]) {
  command = commandAliases[command];
}
```

### 2. Update Help Text

**Modify `templates/help/helpText.txt`:**

Find the line documenting the `featurerequest` command and update it to mention the `fr` alias:

```
featurerequest <description> (or fr) - Submit a feature request to the GitHub repository
```

**Also update `templates/help/helpTextAdmin.txt`** if the command is mentioned there.

### 3. Update `lib/github-app.js` (if needed)

If the github-app module has any hardcoded command name references in responses, update them to mention both aliases:

```javascript
// Example response message update:
sendMessage(`✅ Feature request submitted! Use \`featurerequest\` or \`fr\` to submit more ideas.`, channel);
```

## Testing Checklist

After implementing:

1. ✅ Test `featurerequest test` works
2. ✅ Test `fr test` works  
3. ✅ Test `fr` without description shows usage help
4. ✅ Test `featurerequest` without description shows usage help
5. ✅ Verify help text displays both command options
6. ✅ Check that both commands log user actions correctly

## Minimal Code Change (Quick Implementation)

If you can't locate the exact command parsing location, search for `'featurerequest'` in `index.js` and add this right after the existing featurerequest handler:

```javascript
// Quick alias - add right after existing featurerequest handling
if (input.startsWith('fr ')) {
  // Rewrite command to full version and re-process
  input = 'featurerequest ' + input.substring(3);
  // Then let it fall through to existing featurerequest handler
}
```

This approach rewrites `fr` to `featurerequest` before the command is processed, requiring minimal changes to existing code.