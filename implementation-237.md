# Implementation Plan: Add `fr` alias for `featurerequest` command

## 1. Implementation Plan

This is a simple command alias addition. We need to:
- Locate where the `featurerequest` command is currently handled
- Add `fr` as an alternative trigger for the same functionality
- Ensure both commands work identically

Based on the project structure, commands are likely handled in:
1. The main `index.js` file (message parsing logic)
2. Potentially in `lib/command-handlers.js` or similar

Since the feature request command likely posts to GitHub or logs feedback, it's probably in the main command routing logic in `index.js`.

## 2. Files to Modify

- **`index.js`** - Add alias in command routing logic

## 3. Code Changes

### Modify: `index.js`

Look for where `featurerequest` is currently handled. It should be in the message handling section where commands are parsed. You'll need to find a pattern like:

```javascript
if (input.toLowerCase().startsWith('featurerequest')) {
  // ... feature request logic
}
```

**Change it to:**

```javascript
// Support both 'featurerequest' and 'fr' as aliases
if (input.toLowerCase().startsWith('featurerequest') || input.toLowerCase().startsWith('fr ') || input.toLowerCase() === 'fr') {
  // ... feature request logic
}
```

Or if the code uses a switch/case or command mapping object, update accordingly:

**If using a command map pattern:**

```javascript
// Before
const commandMap = {
  'featurerequest': handleFeatureRequest,
  // ... other commands
};

// After
const commandMap = {
  'featurerequest': handleFeatureRequest,
  'fr': handleFeatureRequest,  // Add alias
  // ... other commands
};
```

**If using multiple if/else statements, add an OR condition:**

```javascript
// Before
if (input.toLowerCase().startsWith('featurerequest ')) {
  const requestText = input.substring('featurerequest '.length);
  // ... handle feature request
}

// After
const inputLower = input.toLowerCase();
if (inputLower.startsWith('featurerequest ') || inputLower.startsWith('fr ')) {
  // Extract text after either 'featurerequest ' or 'fr '
  const requestText = inputLower.startsWith('fr ') 
    ? input.substring(3).trim()  // 'fr ' is 3 characters
    : input.substring('featurerequest '.length).trim();
  // ... handle feature request
}
```

### Update Help Text (if applicable)

If there's help documentation mentioning the `featurerequest` command, update it:

**`templates/help/helpText.txt`** (if exists):

```diff
- featurerequest [your suggestion] - Submit a feature request to the development team
+ featurerequest (or fr) [your suggestion] - Submit a feature request to the development team
```

**`templates/help/helpTextAdmin.txt`** (if the command is documented there):

```diff
- featurerequest [your suggestion] - Submit a feature request
+ featurerequest (or fr) [your suggestion] - Submit a feature request
```

## 4. Testing

After making changes, test both commands:

1. **Test `featurerequest`**: 
   ```
   featurerequest Add more cowbell
   ```

2. **Test `fr` alias**:
   ```
   fr Add more cowbell
   ```

Both should produce identical behavior.

---

## Notes

- If the `featurerequest` command is handled via the AI handler (`lib/ai-handler.js`), you may need to update the system prompt to recognize `fr` as well
- Check if there's a command list or autocomplete feature that needs updating
- Ensure the alias works consistently across both Slack and Discord platforms

Would you like me to search for the exact location of the `featurerequest` command implementation if you can provide more of the `index.js` file around the message handling section?