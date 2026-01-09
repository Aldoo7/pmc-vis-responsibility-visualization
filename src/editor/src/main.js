// The module 'vscode' contains the VS Code extensibility API

//import { constants } from 'buffer';

// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

//Semantic tokenizer
const token = require("./tokens.js");

//Basic internal server setup
// const express = require('express');
// const cors = require('cors');
const { ConnectionViewProvider } = require('./connectionView.js');
const { VirtualFileSystemProvider } = require('./virtualFile.js');
const { Communication } = require('./communication.js')
const constants = require("./constants.js");
const decorations = require("./decorations.js");

let connectionProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ language: 'mdp' }, new token.DocumentSemanticTokensProvider(), token.tokenLegend));

	const fileSystemProvider = new VirtualFileSystemProvider();

	//Add a virtual Filesystem

	// @ts-ignore
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(VirtualFileSystemProvider.uri(), fileSystemProvider, { isCaseSensitive: true }))

	const decorator = new decorations.Decorator();

	const stateView = vscode.window.createTreeView("stateView", { treeDataProvider: decorator });

	stateView.onDidChangeCheckboxState(event => {
		event.items.forEach(item => {
			if (item[1] == vscode.TreeItemCheckboxState.Checked) {
				decorator.selectState(item[0])
			} else {
				decorator.unselectState(item[0])
			}
		})
	})

	connectionProvider = new ConnectionViewProvider(decorator);
	fileSystemProvider.watchSave(connectionProvider);
	connectionProvider.addExistingProjects();

	let communicationStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
	const comm = new Communication(communicationStatus);

	context.subscriptions.push(communicationStatus);

	//Commands for backend communication
	context.subscriptions.push(vscode.window.registerTreeDataProvider("connectionView", connectionProvider));
	context.subscriptions.push(stateView);
	context.subscriptions.push(vscode.commands.registerCommand('connectionView.connect', () => connectionProvider.addProject()))
	context.subscriptions.push(vscode.commands.registerCommand('connectionView.reset', () => connectionProvider.removeProjects()))
	context.subscriptions.push(vscode.commands.registerCommand('connectionView.fill', () => connectionProvider.addExistingProjects()))
	context.subscriptions.push(vscode.commands.registerCommand('connectionView.upload', item => connectionProvider.uploadFile(item)));
	context.subscriptions.push(vscode.commands.registerCommand('connectionView.front', item => connectionProvider.openFrontend(item)));
	context.subscriptions.push(vscode.commands.registerCommand('connectionView.openDocument', item => connectionProvider.openDocument(item)));
	context.subscriptions.push(vscode.commands.registerCommand('connectionView.saveAsLocalFile', item => connectionProvider.saveAsLocalFile(item)));
	context.subscriptions.push(vscode.commands.registerCommand('moveTo', item => moveTo(item)))
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(_ => { resetWorkspace(null) }));
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { resetWorkspace(event.document) }));

	comm.register(constants.EVENT_STATE, update_state);

	// Listen for responsibility results from backend (Socket.IO on 8082)
	comm.register('responsibility:result', (data) => {
		try {
			if (data && data.componentResponsibility) {
				// Apply overlay in the active MDP document
				decorator.updateResponsibility(vscode.window.activeTextEditor, data.componentResponsibility);
			}
		} catch (e) {
			console.error('Failed to apply responsibility overlay', e);
		}
	});

	// Handle responsibility error events
	comm.register('responsibility:error', (e) => vscode.window.showErrorMessage(`Responsibility error: ${e?.message || e}`));
}

function resetWorkspace(document) {
	let activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		connectionProvider.updateText(document);
	}
}

function update_state(data) {
	const states = filterState(data.states)
	connectionProvider.updateState(data.id, states)
}

// async function connectToPMCVis() {
// 	const id = await vscode.window.showInputBox();
// 	if (!id) {
// 		return;
// 	}
// 	activeStateProvider.register(id);
// }

//Here we describe the structure of the global state object
function filterState(data) {
	data = data.map(d => {
		const vars = d.details["Variable Values"];
		return {
			id: d.id,
			type: d.type,
			variables: vars
		};
	});

	return data;
}

function moveTo(line) {
	let activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		activeEditor.revealRange(new vscode.Range(line, 0, line + 10, 0), vscode.TextEditorRevealType.InCenter);
	}
}

// This method is called when your extension is deactivated
function deactivate() { }

module.exports = {
	activate,
	deactivate
}
