import * as vscode from 'vscode';

export class StatusBarManager {
	private readonly statusBarItem: vscode.StatusBarItem;

	constructor() {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			100
		);
		this.statusBarItem.text = '$(sync) Shared Settings';
		this.statusBarItem.tooltip = 'Shared Settings Manager';
		this.statusBarItem.show();
	}

	updateSyncSuccess(): void {
		const currentTime = new Date().toLocaleTimeString();
		this.statusBarItem.text = '$(check) Shared Settings';
		this.statusBarItem.tooltip = `Last synced: ${currentTime}`;
	}

	updateSyncError(errorMessage: string): void {
		this.statusBarItem.text = '$(error) Shared Settings';
		this.statusBarItem.tooltip = `Sync failed: ${errorMessage}`;
	}

	dispose(): void {
		this.statusBarItem.dispose();
	}
}