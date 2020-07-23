import * as vscode from 'vscode';

// Possible positions when C-l is invoked consequtively
enum RecenterPosition {
	Middle,
	Top,
	Bottom
};

export class Editor {
	private lastKill: vscode.Position // if kill position stays the same, append to clipboard
	private justDidKill: boolean
	private centerState: RecenterPosition

	constructor() {
		this.justDidKill = false
		this.lastKill = null
		this.centerState = RecenterPosition.Middle

		vscode.window.onDidChangeActiveTextEditor(event => {
			this.lastKill = null
		})
		vscode.workspace.onDidChangeTextDocument(event => {
			if (!this.justDidKill) {
				this.lastKill = null
			}
			this.justDidKill = false
		})
		vscode.window.onDidChangeTextEditorSelection(event => {
			this.centerState = RecenterPosition.Middle
		})
	}

	static isOnLastLine(): boolean {
		return vscode.window.activeTextEditor.selection.active.line == vscode.window.activeTextEditor.document.lineCount - 1
	}

	setStatusBarMessage(text: string): vscode.Disposable {
		return vscode.window.setStatusBarMessage(text, 1000);
	}

	setStatusBarPermanentMessage(text: string): vscode.Disposable {
		return vscode.window.setStatusBarMessage(text);
	}

	getSelectionRange(): vscode.Range {
		let selection = vscode.window.activeTextEditor.selection,
			start = selection.start,
			end = selection.end;

		return (start.character !== end.character || start.line !== end.line) ? new vscode.Range(start, end) : null;
	}

	getSelection(): vscode.Selection {
		return vscode.window.activeTextEditor.selection;
	}

	getSelectionText(): string {
		let r = this.getSelectionRange()
		return r ? vscode.window.activeTextEditor.document.getText(r) : ''
	}

	setSelection(start: vscode.Position, end: vscode.Position): void {
		let editor = vscode.window.activeTextEditor;
		editor.selection = new vscode.Selection(start, end);
	}

	getCurrentPos(): vscode.Position {
		return vscode.window.activeTextEditor.selection.active
	}

	// Kill to end of line
	async kill(): Promise<boolean> {
		// Ignore whatever we have selected before
		await vscode.commands.executeCommand("emacs.exitMarkMode")

		let startPos = this.getCurrentPos(),
			isOnLastLine = Editor.isOnLastLine()

		// Move down an entire line (not just the wrapped part), and to the beginning.
		await vscode.commands.executeCommand("cursorMove", { to: "down", by: "line", select: false })
		if (!isOnLastLine) {
			await vscode.commands.executeCommand("cursorMove", { to: "wrappedLineStart" })
		}

		let endPos = this.getCurrentPos(),
			range = new vscode.Range(startPos, endPos),
			txt = vscode.window.activeTextEditor.document.getText(range)

		// If there is something other than whitespace in the selection, we do not cut the EOL too
		if (!isOnLastLine && !txt.match(/^\s*$/)) {
			await vscode.commands.executeCommand("cursorMove", { to: "left", by: "character" })
			endPos = this.getCurrentPos()
		}

		// Select it now, cut the selection, remember the position in case of multiple cuts from same spot
		this.setSelection(startPos, endPos)
		let promise = this.cut(this.lastKill != null && startPos.isEqual(this.lastKill))

		promise.then(() => {
			this.justDidKill = true
			this.lastKill = startPos
		})

		return promise
	}

	async copy(): void {
		await vscode.env.clipboard.writeText(this.getSelectionText())
		vscode.commands.executeCommand("emacs.exitMarkMode")
	}

	async cut(appendClipboard?: boolean): Thenable<boolean> {
		if (appendClipboard) {
			await vscode.env.clipboard.writeText((await vscode.env.clipboard.readText()) + this.getSelectionText());
		} else {
			await vscode.env.clipboard.writeText(this.getSelectionText());
		}
		let t = Editor.delete(this.getSelectionRange());
		vscode.commands.executeCommand("emacs.exitMarkMode");
		return t
	}

	yank(): Thenable<{}> {
		this.justDidKill = false
		return Promise.all([
			vscode.commands.executeCommand("editor.action.clipboardPasteAction"),
			vscode.commands.executeCommand("emacs.exitMarkMode")])
	}

	undo(): void {
		vscode.commands.executeCommand("undo");
	}
	redo(): void {
		vscode.commands.executeCommand("redo");
	}

	private getFirstBlankLine(range: vscode.Range): vscode.Range {
		let doc = vscode.window.activeTextEditor.document;

		if (range.start.line === 0) {
			return range;
		}
		range = doc.lineAt(range.start.line - 1).range;
		while (range.start.line > 0 && range.isEmpty) {
			range = doc.lineAt(range.start.line - 1).range;
		}
		if (range.isEmpty) {
			return range;
		} else {
			return doc.lineAt(range.start.line + 1).range;
		}
	}

	async deleteBlankLines() {
		let selection = this.getSelection(),
			anchor = selection.anchor,
			doc = vscode.window.activeTextEditor.document,
			range = doc.lineAt(selection.start.line).range,
			nextLine: vscode.Position;

		if (range.isEmpty) {
			range = this.getFirstBlankLine(range);
			anchor = range.start;
			nextLine = range.start;
		} else {
			nextLine = range.start.translate(1, 0);
		}
		selection = new vscode.Selection(nextLine, nextLine);
		vscode.window.activeTextEditor.selection = selection;

		for (let line = selection.start.line;
			line < doc.lineCount - 1 && doc.lineAt(line).range.isEmpty;
			++line) {

			await vscode.commands.executeCommand("deleteRight")
		}
		vscode.window.activeTextEditor.selection = new vscode.Selection(anchor, anchor)
	}

	static delete(range: vscode.Range = null): Thenable<boolean> {
		if (range) {
			return vscode.window.activeTextEditor.edit(editBuilder => {
				editBuilder.delete(range);
			});
		}
	}

	deleteLine(): void {
		vscode.commands.executeCommand("emacs.exitMarkMode"); // emulate Emacs
		vscode.commands.executeCommand("editor.action.deleteLines");
	}

	scrollLineToCenterTopBottom = () => {
		const editor = vscode.window.activeTextEditor
		const selection = editor.selection

		switch (this.centerState) {
			case RecenterPosition.Middle:
				this.centerState = RecenterPosition.Top;
				editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
				break;
			case RecenterPosition.Top:
				this.centerState = RecenterPosition.Bottom;
				editor.revealRange(selection, vscode.TextEditorRevealType.AtTop);
				break;
			case RecenterPosition.Bottom:
				this.centerState = RecenterPosition.Middle;
				// There is no AtBottom, so instead scroll a page up (without moving cursor).
				// The current line then ends up as the last line of the window (more or less)
				vscode.commands.executeCommand("scrollPageUp");
				break;
		}
	}

	breakLine() {
		vscode.commands.executeCommand("lineBreakInsert");
		vscode.commands.executeCommand("emacs.cursorHome");
		vscode.commands.executeCommand("emacs.cursorDown");
	}

	deleteDirection(command): void {
		let selectionText = this.getSelectionText();

		if (selectionText.length == 0) {
			vscode.commands.executeCommand(command)
		} else {
			Editor.delete(this.getSelectionRange());
		}

		vscode.commands.executeCommand('emacs.exitMarkMode');
	}

	deleteLeft(): void {
		this.deleteDirection('deleteLeft');
	}
	deleteRight(): void {
		this.deleteDirection('deleteRight');
	}
}
