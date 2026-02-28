import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { deepMerge } from './utils/deepMerge';
import { removeKeys } from './utils/removeKeys';

import * as JSONC from 'jsonc-parser';

export class SettingsManager {
	private readonly workspaceFolderPath: string;
	private readonly sharedSettingsFilePath: string;
	private readonly settingsFilePath: string;
	private readonly outputChannel: vscode.OutputChannel;

	constructor(workspaceFolder: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel) {
		this.workspaceFolderPath = workspaceFolder.uri.fsPath;
		this.sharedSettingsFilePath = path.join(this.workspaceFolderPath, '.vscode', 'settings.shared.json');
		this.settingsFilePath = path.join(this.workspaceFolderPath, '.vscode', 'settings.json');
		this.outputChannel = outputChannel;
	}

	/**
	 * Main sync operation: reads shared settings, removes those keys from settings.json,
	 * then deep merges shared settings back in.
	 */
	async syncSettings(): Promise<void> {
		try {
			this.outputChannel.appendLine(`[${new Date().toISOString()}] Starting settings sync...`);

			// Read shared settings
			const sharedSettingsContent = await this.readSharedSettings();
			if (!sharedSettingsContent) {
				this.outputChannel.appendLine('No shared settings found, skipping sync');
				return;
			}

			// Read current settings (or create empty object if doesn't exist)
			const currentSettingsContent = await this.readSettings();

			// Remove all keys that exist in shared settings
			const cleanedSettings = removeKeys(currentSettingsContent, sharedSettingsContent);

			// Deep merge shared settings into cleaned settings
			const mergedSettings = deepMerge(cleanedSettings, sharedSettingsContent);

			// Write back to settings.json
			await this.writeSettings(mergedSettings);

			this.outputChannel.appendLine('Settings sync completed successfully');
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.outputChannel.appendLine(`ERROR: Settings sync failed: ${errorMessage}`);
			throw new Error(`Settings sync failed in ${this.syncSettings.name}: ${errorMessage}. Check that .vscode/settings.shared.json is valid JSON.`);
		}
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
	 * Reads and parses settings.json, returns empty object if file doesn't exist
	 */
	private async readSettings(): Promise<Record<string, unknown>> {
		try {
			const fileContent = await fs.readFile(this.settingsFilePath, 'utf-8');
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
	 * Writes settings object to settings.json with pretty formatting
	 */
	private async writeSettings(settingsContent: Record<string, unknown>): Promise<void> {
		try {
			// Ensure .vscode directory exists
			const vscodeDirPath = path.join(this.workspaceFolderPath, '.vscode');
			await fs.mkdir(vscodeDirPath, { recursive: true });

			// Write with pretty formatting (2 space indent)
			const jsonContent = JSON.stringify(settingsContent, null, 2);
			await fs.writeFile(this.settingsFilePath, jsonContent, 'utf-8');

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
