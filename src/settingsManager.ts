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
	private readonly outputChannel: vscode.OutputChannel;
	private lastSharedSettingsHash: string = '';
	private lastSettingsJsonHash: string = '';

	constructor(workspaceFolder: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel) {
		this.workspaceFolderPath = workspaceFolder.uri.fsPath;
		this.sharedSettingsFilePath = path.join(this.workspaceFolderPath, '.vscode', 'settings.shared.json');
		this.settingsFilePath = path.join(this.workspaceFolderPath, '.vscode', 'settings.json');
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

			// Conservative check: verify if all shared settings values already match in settings.json
			if (this.allSharedSettingsMatch(currentSettingsContent, sharedSettingsContent)) {
				this.outputChannel.appendLine('All shared settings already match current settings, no sync needed');
				this.lastSharedSettingsHash = sharedSettingsHash;
				this.lastSettingsJsonHash = currentSettingsHash;
				return false;
			}

			// Remove all keys that exist in shared settings
			const cleanedSettings = removeKeys(currentSettingsContent, sharedSettingsContent);

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
			const parsedContent = JSONC.parse(fileContent, parseErrors);

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
			const parsedContent = JSONC.parse(fileContent, parseErrors);

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
	 * Writes settings object to settings.json while preserving user comments.
	 * Uses JSONC edit API to modify only the necessary keys.
	 */
	private async writeSettings(settingsContent: Record<string, unknown>): Promise<void> {
		try {
			// Ensure .vscode directory exists
			const vscodeDirPath = path.join(this.workspaceFolderPath, '.vscode');
			await fs.mkdir(vscodeDirPath, { recursive: true });

			// Read existing file content (preserving comments)
			let originalText = '';
			let originalObject: Record<string, unknown> = {};

			try {
				originalText = await fs.readFile(this.settingsFilePath, 'utf-8');
				// Remove our marker comment for parsing
				const textWithoutMarker = originalText.replace(/\s*\/\/\s*Team settings \(merged from \.vscode\/settings\.shared\.json\)\s*\n?/gi, '\n');
				originalObject = JSONC.parse(textWithoutMarker) as Record<string, unknown>;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
				// File doesn't exist - will create new
			}

			// Use JSONC modify API to preserve comments
			let resultText = originalText || '{\n}';
			const formattingOptions = { tabSize: 2, insertSpaces: true, eol: '\n' };

			// First, remove keys that no longer exist in target
			for (const key in originalObject) {
				if (!Object.prototype.hasOwnProperty.call(settingsContent, key)) {
					const edits = JSONC.modify(resultText, [key], undefined, { formattingOptions });
					resultText = JSONC.applyEdits(resultText, edits);
				}
			}

			// Then, add or update all keys from target
			for (const key in settingsContent) {
				if (!Object.prototype.hasOwnProperty.call(settingsContent, key)) {
					continue;
				}
				const edits = JSONC.modify(resultText, [key], settingsContent[key], { formattingOptions });
				resultText = JSONC.applyEdits(resultText, edits);
			}

			// Add team settings marker comment before the closing brace
			const sharedSettings = await this.readSharedSettings();
			if (sharedSettings && Object.keys(sharedSettings).length > 0) {
				// Find the position just before the last closing brace
				const lastBraceIndex = resultText.lastIndexOf('}');
				if (lastBraceIndex !== -1) {
					const beforeBrace = resultText.substring(0, lastBraceIndex);
					const afterBrace = resultText.substring(lastBraceIndex);

					// Check if marker already exists
					if (!beforeBrace.includes('// Team settings (merged from .vscode/settings.shared.json)')) {
						resultText = beforeBrace + '\n  // Team settings (merged from .vscode/settings.shared.json)\n' + afterBrace;
					}
				}
			}

			await fs.writeFile(this.settingsFilePath, resultText, 'utf-8');

			this.outputChannel.appendLine(`Wrote updated settings to ${this.settingsFilePath}`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to write settings.json in ${this.writeSettings.name}: ${errorMessage}`);
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
