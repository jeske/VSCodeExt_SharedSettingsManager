import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { deepMerge } from './utils/deepMerge';
import { removeKeys } from './utils/removeKeys';
import * as JSONC from 'jsonc-parser';

export class SettingsManager {
	private readonly workspaceFolderPath: string;
	private readonly sharedSettingsFilePath: string;
	private readonly settingsFilePath: string;
	private readonly lastSyncFilePath: string;
	private readonly outputChannel: vscode.OutputChannel;
	private lastSharedSettingsHash: string = '';
	private lastSettingsJsonHash: string = '';

	constructor(workspaceFolder: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel) {
		this.workspaceFolderPath = workspaceFolder.uri.fsPath;
		this.sharedSettingsFilePath = path.join(this.workspaceFolderPath, '.vscode', 'settings.shared.json');
		this.settingsFilePath = path.join(this.workspaceFolderPath, '.vscode', 'settings.json');
		this.lastSyncFilePath = path.join(this.workspaceFolderPath, '.vscode', 'settings.shared-lastsync.json');
		this.outputChannel = outputChannel;
	}

	/**
	 * Main sync operation: reads shared settings, removes those keys from settings.json,
	 * then deep merges shared settings back in.
	 * Returns true if sync was performed, false if skipped due to no changes.
	 */
	async syncSettings(): Promise<boolean> {
		try {
			this.outputChannel.appendLine(`[${new Date().toISOString()}] Checking for settings changes...`);

			// Read shared settings and check if changed
			const sharedSettingsContent = await this.readSharedSettings();
			if (!sharedSettingsContent) {
				this.outputChannel.appendLine('No shared settings found, skipping sync');
				return false;
			}

			const sharedSettingsText = JSON.stringify(sharedSettingsContent, null, 2);
			const sharedSettingsHash = this.computeHash(sharedSettingsText);

			// Read current settings and check if changed
			const currentSettingsContent = await this.readSettings();
			const currentSettingsText = JSON.stringify(currentSettingsContent, null, 2);
			const currentSettingsHash = this.computeHash(currentSettingsText);

			// Check if either file actually changed
			const sharedChanged = sharedSettingsHash !== this.lastSharedSettingsHash;
			const settingsChanged = currentSettingsHash !== this.lastSettingsJsonHash;

			if (!sharedChanged && !settingsChanged) {
				this.outputChannel.appendLine('No actual changes detected (hash match), skipping sync');
				return false;
			}

			this.outputChannel.appendLine(`Changes detected - shared: ${sharedChanged}, settings: ${settingsChanged}`);

			// Read previously managed keys from last sync file
			const previouslyManagedKeys = await this.readLastSyncKeys();

			// Remove previously managed keys (handles deleted shared settings)
			let cleanedSettings = currentSettingsContent;
			if (previouslyManagedKeys.length > 0) {
				const keysToRemove = Object.fromEntries(previouslyManagedKeys.map((k: string) => [k, null]));
				cleanedSettings = removeKeys(cleanedSettings, keysToRemove);
				this.outputChannel.appendLine(`Removed ${previouslyManagedKeys.length} previously managed keys`);
			}

			// Conservative check: verify if all shared settings values already match in settings.json
			if (this.allSharedSettingsMatch(cleanedSettings, sharedSettingsContent)) {
				this.outputChannel.appendLine('All shared settings already match current settings, no sync needed');
				this.lastSharedSettingsHash = sharedSettingsHash;
				this.lastSettingsJsonHash = currentSettingsHash;
				// Update last sync file even if no write needed
				await this.writeLastSyncKeys(Object.keys(sharedSettingsContent));
				return false;
			}

			// Deep merge shared settings into cleaned settings
			const mergedSettings = deepMerge(cleanedSettings, sharedSettingsContent);

			// Compute what the new settings.json will be
			const newSettingsText = JSON.stringify(mergedSettings, null, 2);
			const newSettingsHash = this.computeHash(newSettingsText);

			// Final check: if the result would actually be identical
			if (newSettingsHash === currentSettingsHash) {
				this.outputChannel.appendLine('Computed result matches current settings, no write needed');
				this.lastSharedSettingsHash = sharedSettingsHash;
				this.lastSettingsJsonHash = currentSettingsHash;
				return false;
			}

			// Write back to settings.json
			await this.writeSettings(mergedSettings);

			// Write last sync tracking file
			await this.writeLastSyncKeys(Object.keys(sharedSettingsContent));

			// Update hashes AFTER successful write
			this.lastSharedSettingsHash = sharedSettingsHash;
			this.lastSettingsJsonHash = newSettingsHash;

			this.outputChannel.appendLine('Settings sync completed successfully');
			return true;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`ERROR: Settings sync failed: ${errorMessage}`);
			throw new Error(`Settings sync failed in ${this.syncSettings.name}: ${errorMessage}. Check that .vscode/settings.shared.json is valid JSON.`);
		}
	}

	/**
	 * Compute SHA256 hash of content for change detection
	 */
	private computeHash(content: string): string {
		return createHash('sha256').update(content).digest('hex');
	}

	/**
	 * Check if all shared settings values already exist and match in current settings
	 */
	private allSharedSettingsMatch(
		currentSettings: Record<string, unknown>,
		sharedSettings: Record<string, unknown>
	): boolean {
		for (const key in sharedSettings) {
			if (!Object.prototype.hasOwnProperty.call(sharedSettings, key)) {
				continue;
			}

			const sharedValue = sharedSettings[key];
			const currentValue = currentSettings[key];

			// Deep equality check
			if (JSON.stringify(sharedValue) !== JSON.stringify(currentValue)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Reads and parses settings.shared.json
	 */
	private async readSharedSettings(): Promise<Record<string, unknown> | null> {
		try {
			const fileContent = await fs.readFile(this.sharedSettingsFilePath, 'utf-8');
			const parseErrors: JSONC.ParseError[] = [];
			const parsedContent = JSONC.parse(fileContent, parseErrors, { allowTrailingComma: true });

			if (parseErrors.length > 0) {
				const firstError = parseErrors[0];
				const errorDetails = {
					file: this.sharedSettingsFilePath,
					offset: firstError.offset,
					error: JSONC.printParseErrorCode(firstError.error)
				};
				throw Object.assign(
					new Error(`JSON parse error at offset ${firstError.offset}: ${JSONC.printParseErrorCode(firstError.error)}`),
					{ parseError: errorDetails }
				);
			}

			if (typeof parsedContent !== 'object' || parsedContent === null || Array.isArray(parsedContent)) {
				throw new Error('settings.shared.json must contain a JSON object');
			}

			return parsedContent as Record<string, unknown>;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				// File doesn't exist - this is okay
				return null;
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to read settings.shared.json in ${this.readSharedSettings.name}: ${errorMessage}`);
		}
	}

	/**
	 * Reads and parses settings.json, returns empty object if file doesn't exist.
	 * Strips out our team settings marker comment before parsing.
	 */
	private async readSettings(): Promise<Record<string, unknown>> {
		try {
			let fileContent = await fs.readFile(this.settingsFilePath, 'utf-8');

			// Remove our marker comment line if present (so it doesn't interfere with parsing/hashing)
			fileContent = fileContent.replace(/\s*\/\/\s*Team settings \(merged from \.vscode\/settings\.shared\.json\)\s*\n?/gi, '\n');

			const parseErrors: JSONC.ParseError[] = [];
			const parsedContent = JSONC.parse(fileContent, parseErrors, { allowTrailingComma: true });

			if (parseErrors.length > 0) {
				const firstError = parseErrors[0];
				const errorDetails = {
					file: this.settingsFilePath,
					offset: firstError.offset,
					error: JSONC.printParseErrorCode(firstError.error)
				};
				throw Object.assign(
					new Error(`JSON parse error at offset ${firstError.offset}: ${JSONC.printParseErrorCode(firstError.error)}`),
					{ parseError: errorDetails }
				);
			}

			if (typeof parsedContent !== 'object' || parsedContent === null || Array.isArray(parsedContent)) {
				throw new Error('settings.json must contain a JSON object');
			}

			return parsedContent as Record<string, unknown>;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				// File doesn't exist - return empty object
				this.outputChannel.appendLine('settings.json does not exist, will create it');
				return {};
			}

			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to read settings.json in ${this.readSettings.name}: ${errorMessage}`);
		}
	}

	/**
	 * Writes settings to settings.json preserving comments and maintaining proper ordering.
	 * Uses JSONC modify API for surgical edits, then appends team settings block.
	 */
	private async writeSettings(settingsContent: Record<string, unknown>): Promise<void> {
		try {
			// Ensure .vscode directory exists
			const vscodeDirPath = path.join(this.workspaceFolderPath, '.vscode');
			await fs.mkdir(vscodeDirPath, { recursive: true });

			// Read shared settings to know which keys are team settings
			const sharedSettings = await this.readSharedSettings();
			if (!sharedSettings) {
				return;
			}

			const sharedKeys = Object.keys(sharedSettings);
			const previouslyManagedKeys = await this.readLastSyncKeys();

			// Read existing file
			let text = '';
			try {
				text = await fs.readFile(this.settingsFilePath, 'utf-8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					text = '{\n}';
				} else {
					throw error;
				}
			}

			const formattingOptions = { tabSize: 2, insertSpaces: true, eol: '\n' };
			const marker = '// Team settings (merged from .vscode/settings.shared.json)';

			// Step 1: Remove old managed keys using modify() - preserves comments
			for (const key of previouslyManagedKeys) {
				const edits = JSONC.modify(text, [key], undefined, { formattingOptions });
				text = JSONC.applyEdits(text, edits);
			}

			// Step 2: Remove old marker comment line if present
			const markerIndex = text.indexOf(marker);
			if (markerIndex >= 0) {
				const lineStart = text.lastIndexOf('\n', markerIndex);
				const lineEnd = text.indexOf('\n', markerIndex + marker.length);
				text = text.substring(0, lineStart) + text.substring(lineEnd >= 0 ? lineEnd : text.length);
			}

			// Step 3: Add/update personal settings using modify() - preserves comments
			for (const key in settingsContent) {
				if (!sharedKeys.includes(key)) {
					const edits = JSONC.modify(text, [key], settingsContent[key], { formattingOptions });
					text = JSONC.applyEdits(text, edits);
				}
			}

			// Step 4: Find closing brace, append shared block before it
			const closingBraceIndex = text.lastIndexOf('}');
			const beforeBrace = text.substring(0, closingBraceIndex).trimEnd();
			const needsComma = !/,\s*$/.test(beforeBrace);

			let sharedBlock = '\n\n  ' + marker + '\n';
			for (let i = 0; i < sharedKeys.length; i++) {
				const key = sharedKeys[i];
				const value = sharedSettings[key];
				const jsonValue = JSON.stringify(value);
				const comma = i < sharedKeys.length - 1 ? ',' : '';
				sharedBlock += `  "${key}": ${jsonValue}${comma}\n`;
			}

			text = beforeBrace + (needsComma ? ',' : '') + sharedBlock + '}';

			// Step 5: Write back
			await fs.writeFile(this.settingsFilePath, text, 'utf-8');

			this.outputChannel.appendLine(`Wrote updated settings to ${this.settingsFilePath}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to write settings.json in ${this.writeSettings.name}: ${errorMessage}`);
		}
	}

	/**
	 * Read the list of keys that were managed in the last sync
	 */
	private async readLastSyncKeys(): Promise<string[]> {
		try {
			const fileContent = await fs.readFile(this.lastSyncFilePath, 'utf-8');
			const parsed = JSON.parse(fileContent);
			return Array.isArray(parsed.managedKeys) ? parsed.managedKeys : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				// File doesn't exist yet
				return [];
			}
			this.outputChannel.appendLine(`Warning: Could not read last sync file: ${error}`);
			return [];
		}
	}

	/**
	 * Write the list of currently managed keys to the last sync tracking file
	 */
	private async writeLastSyncKeys(managedKeys: string[]): Promise<void> {
		try {
			const content = {
				written_by: 'Shared Settings Extension',
				purpose: 'Track previously synced shared settings so we can remove them if they get removed from the shared settings.',
				warning: 'DO NOT EDIT THIS FILE',
				managedKeys,
				lastSync: new Date().toISOString()
			};
			await fs.writeFile(this.lastSyncFilePath, JSON.stringify(content, null, 2), 'utf-8');
		} catch (error) {
			this.outputChannel.appendLine(`Warning: Could not write last sync file: ${error}`);
		}
	}

	/**
	 * Checks if settings.shared.json exists
	 */
	async sharedSettingsExists(): Promise<boolean> {
		try {
			await fs.access(this.sharedSettingsFilePath);
			return true;
		} catch {
			return false;
		}
	}
}
