# Shared Settings Manager

A VSCode extension that automatically merge-adds shared team settings from `.vscode/settings.shared.json` into `.vscode/settings.json`. This allows you to keep your (non-tracked) personal settings in .vscode/settings.json where other tools naturally edit them, while still having git tracked project settings.

## Features

- 🔄 **Automatic Sync**: Watches for changes to `settings.shared.json` and automatically updates `settings.json`
- 🔀 **Deep Merge**: Recursively merges nested objects while preserving your personal settings
- 🧹 **Clean Merge**: Removes old shared settings before applying new ones to prevent conflicts
- 📊 **Status Bar**: Shows sync status and last sync time
- 🚀 **Zero Configuration**: Works automatically when `settings.shared.json` exists

## How It Works

1. Create a `.vscode/settings.shared.json` file in your workspace with project-team-wide settings
2. The extension automatically detects the file and performs an initial sync
3. Any changes to `settings.shared.json` trigger an automatic sync
4. Your personal settings in `settings.json` are preserved (unless they conflict with shared settings, and then they are clobbered, shame on you)

## Sync Process

The extension follows this process:

1. **Read** `settings.shared.json`
2. **Remove** all keys from `settings.json` that exist in the shared file
3. **Deep merge** the shared settings into the cleaned `settings.json`
4. **Write** the updated `settings.json` back to disk

This ensures that:
- Shared settings always take precedence
- Old shared settings are properly removed when they're deleted from the shared file
- Personal settings that don't conflict are preserved

## Example

**settings.shared.json** (team settings):
```json
{
  "editor.tabSize": 2,
}
```

**settings.json** (before sync):
```json
{
  "editor.tabSize": 4,
  "editor.fontSize": 12,
  "terminal.integrated.fontSize": 13,
  "workbench.colorTheme": "Default Dark+"
}
```

**settings.json** (after sync):
```json
{
    // user settings    
    "editor.fontSize": 12,
    "terminal.integrated.fontSize": 13,
    "workbench.colorTheme": "Default Dark+",

    // TEAM settings (from .vscode/settings.shared.json)
    "editor.tabSize": 2
}
```

## Status Bar

The extension shows a status bar item on the right side:

- ✅ **$(check) Shared Settings**: Sync successful (hover to see last sync time)
- ❌ **$(error) Shared Settings**: Sync failed (hover to see error message)
- 🔄 **$(sync) Shared Settings**: Initial state

## Output Channel

For detailed logging, open the "Shared Settings Manager" output channel:
- View → Output → Select "Shared Settings Manager" from dropdown

## Use Cases

### Team Consistency
Ensure all team members use the same:
- Code formatting settings
- Linter configurations
- Editor preferences
- File associations

### Project-Specific Settings
Different projects can have different shared settings while developers maintain their personal preferences.

### Onboarding
New team members automatically get the correct settings when they clone the repository.

## Best Practices

1. **Commit `settings.shared.json`** to version control
2. **Add `settings.json` to `.gitignore`** to keep personal settings private
3. **Document shared settings** with comments (JSON5 format not supported, use separate docs)
4. **Keep shared settings minimal** - only include truly team-wide requirements

## Troubleshooting

### Settings not syncing
- Check the Output channel for error messages
- Verify `settings.shared.json` contains valid JSON
- Ensure the file is in the `.vscode` folder of your workspace root

### Personal settings being overwritten
- This is expected behavior for keys that exist in `settings.shared.json`
- Move personal preferences to keys that aren't in the shared file
- Or discuss with your team about removing that setting from shared

### Extension not activating
- The extension only activates when `settings.shared.json` exists
- Create the file to trigger activation

## Requirements

- VSCode 1.85.0 or higher

## Extension Settings

This extension has no configurable settings - it works automatically.

## Known Limitations

- Only works with the first workspace folder in multi-root workspaces
- Does not preserve comments in JSON files (JSON limitation)
- Arrays are replaced, not merged (by design)

## Release Notes

### 0.1.0

Initial release:
- Automatic sync of shared settings
- Deep merge support
- Status bar indicator
- File watcher for real-time updates

## Contributing

Found a bug or have a feature request? Please open an issue on GitHub.

## License

MIT