import * as vscode from 'vscode';
import { SettingsManager } from './settingsManager';
import { StatusBarManager } from './statusBar';

let settingsFileWatcher: vscode.FileSystemWatcher | undefined;
let statusBarManager: StatusBarManager | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let syncDebounceTimer: NodeJS.Timeout | undefined;

export function activate(extensionContext: vscode.ExtensionContext) {
	const localOutputChannel = vscode.window.createOutputChannel('Shared Settings Manager');
	outputChannel = localOutputChannel;
	localOutputChannel.appendLine('Shared Settings Manager extension activated');

	// Get the first workspace folder
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		localOutputChannel.appendLine('No workspace folder found, extension will not activate');
		return;
	}

	const primaryWorkspaceFolder = workspaceFolders[0];
	const settingsManager = new SettingsManager(primaryWorkspaceFolder, localOutputChannel);

	// Initialize status bar
	statusBarManager = new StatusBarManager();
	extensionContext.subscriptions.push(statusBarManager);

	// Check if settings.shared.json exists and perform initial sync
	settingsManager.sharedSettingsExists().then(exists => {
		if (exists) {
			localOutputChannel.appendLine('Found settings.shared.json, performing initial sync...');
			performSync(settingsManager, localOutputChannel);
		} else {
			localOutputChannel.appendLine('No settings.shared.json found, waiting for file creation...');
		}
	});

	// Set language mode for settings.shared.json to JSONC
	vscode.workspace.onDidOpenTextDocument(document => {
		if (document.fileName.endsWith('.vscode/settings.shared.json') ||
		    document.fileName.endsWith('.vscode\\settings.shared.json')) {
			vscode.languages.setTextDocumentLanguage(document, 'jsonc');
		}
	});

	// Also set it for currently open documents
	vscode.workspace.textDocuments.forEach(document => {
		if (document.fileName.endsWith('.vscode/settings.shared.json') ||
		    document.fileName.endsWith('.vscode\\settings.shared.json')) {
			vscode.languages.setTextDocumentLanguage(document, 'jsonc');
		}
	});

	// Setup file watcher for settings.shared.json
	const sharedSettingsPattern = new vscode.RelativePattern(
		primaryWorkspaceFolder,
		'.vscode/settings.shared.json'
	);

	settingsFileWatcher = vscode.workspace.createFileSystemWatcher(sharedSettingsPattern);

	// Watch for changes to settings.shared.json
	settingsFileWatcher.onDidChange(() => {
		localOutputChannel.appendLine('Detected change to settings.shared.json');
		debouncedPerformSync(settingsManager, localOutputChannel);
	});

	// Watch for creation of settings.shared.json
	settingsFileWatcher.onDidCreate(() => {
		localOutputChannel.appendLine('Detected creation of settings.shared.json');
		debouncedPerformSync(settingsManager, localOutputChannel);
	});

	// Watch for deletion of settings.shared.json
	settingsFileWatcher.onDidDelete(() => {
		localOutputChannel.appendLine('settings.shared.json was deleted');
		if (statusBarManager) {
			statusBarManager.updateSyncError('Shared settings file deleted');
		}
	});

	extensionContext.subscriptions.push(settingsFileWatcher);

	// Also watch settings.json to re-apply shared settings when it's edited
	const settingsPattern = new vscode.RelativePattern(
		primaryWorkspaceFolder,
		'.vscode/settings.json'
	);

	const settingsJsonWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern);

	// CRITICAL: Any change, creation, or deletion of settings.json triggers sync
	// This handles: edits, renames, deletions - all scenarios
	settingsJsonWatcher.onDidChange(() => {
		localOutputChannel.appendLine('Detected change to settings.json, re-applying shared settings');
		debouncedPerformSync(settingsManager, localOutputChannel);
	});

	settingsJsonWatcher.onDidCreate(() => {
		localOutputChannel.appendLine('Detected creation of settings.json, applying shared settings');
		debouncedPerformSync(settingsManager, localOutputChannel);
	});

	settingsJsonWatcher.onDidDelete(() => {
		localOutputChannel.appendLine('settings.json was deleted, recreating with shared settings');
		debouncedPerformSync(settingsManager, localOutputChannel);
	});

	extensionContext.subscriptions.push(settingsJsonWatcher);
	extensionContext.subscriptions.push(localOutputChannel);
}

/**
 * Debounced sync to prevent race conditions when multiple rapid changes occur.
 * Waits 300ms after last change before syncing.
 */
function debouncedPerformSync(
	settingsManager: SettingsManager,
	logOutputChannel: vscode.OutputChannel
): void {
	// Clear existing timer
	if (syncDebounceTimer) {
		clearTimeout(syncDebounceTimer);
	}

	// Set new timer
	syncDebounceTimer = setTimeout(() => {
		performSync(settingsManager, logOutputChannel);
	}, 300);
}

/**
 * Performs the settings sync operation and updates status bar
 */
async function performSync(
	settingsManager: SettingsManager,
	logOutputChannel: vscode.OutputChannel
): Promise<void> {
	try {
		await settingsManager.syncSettings();
		if (statusBarManager) {
			statusBarManager.updateSyncSuccess();
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		logOutputChannel.appendLine(`Sync failed: ${errorMessage}`);

		// Check if this is a parse error with file information
		const parseErrorDetails = (error as any).parseError;
		if (parseErrorDetails && parseErrorDetails.file) {
			// Open the problematic file
			const fileUri = vscode.Uri.file(parseErrorDetails.file);
			const document = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(document);

			// Show error dialog
			vscode.window.showErrorMessage(
				`JSON Parse Error in ${parseErrorDetails.file.split(/[/\\]/).pop()}: ${parseErrorDetails.error} at offset ${parseErrorDetails.offset}`,
				'OK'
			);
		} else {
			// Generic error - just show message
			vscode.window.showErrorMessage(`Shared Settings Sync Failed: ${errorMessage}`, 'OK');
		}

		if (statusBarManager) {
			statusBarManager.updateSyncError(errorMessage);
		}
	}
}

export function deactivate() {
	if (settingsFileWatcher) {
		settingsFileWatcher.dispose();
	}
	if (statusBarManager) {
		statusBarManager.dispose();
	}
	if (outputChannel) {
		outputChannel.dispose();
	}
}
