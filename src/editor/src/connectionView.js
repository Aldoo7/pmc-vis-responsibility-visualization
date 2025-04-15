const vscode = require('vscode');

//Decorations in TextEditor
const decorations = require("./decorations.js");

class ConnectionViewProvider {

    constructor() {
        this._openProjects = [];

        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    async addProject() {
        const id = await vscode.window.showInputBox();
        if (!id) {
            return;
        }

        this._openProjects.push(new ConnectionItem(id));
        vscode.workspace.fs.createDirectory(vscode.Uri.parse(`virtual:/${id}`))
        this.refresh()
    }

    removeProject(projectID) {
        this._openProjects = this._openProjects.filter(item => item._projectID != projectID);
        this.refresh()
    }

    getChildren(element) {
        if (element) {
            return element._children;
        } else {
            return this._openProjects;
        }
    }

    getTreeItem(element) {
        return element;
    }

    getProject(element) {
        return this._openProjects.find(project => element.label == project.label)
    }

    async refresh() {
        await Promise.all(this._openProjects.map(async project => await project.refresh()))
        this._onDidChangeTreeData.fire(undefined);
    }

    async uploadFile(element) {
        let activeEditor = vscode.window.activeTextEditor
        const project = this.getProject(element);
        if (activeEditor && project) {
            switch (String(activeEditor.document.languageId)) {
                case "mdp":
                    await project.uploadFile("upload-model");
                    break;
                case "props":
                    await project.uploadFile("upload-properties");
                    break;
                default:
                    vscode.window.showInformationMessage("File not recognized")
            }
        } else {
            if (project) {
                vscode.window.showInformationMessage("No active editor")
            } else {
                vscode.window.showInformationMessage("No project found")
            }
        }
        this.refresh()
    }

    saveAsLocalFile(element) {
        if (element) {
            element.saveAsLocalFile();
        }
    }

    openFrontend(element) {
        const project = this.getProject(element);
        if (project) {
            project.openFrontend()
        }
    }

    openDocument(element) {
        element.openDocument()
    }

    onSave(uri, content) {
        let matchingItem = undefined;
        for (const project of this._openProjects) {
            for (const item of this.getChildren(project)) {
                if (item.getUri() && item.getUri().toString() == uri.toString()) {
                    matchingItem = item;
                }
            }
        }
        if (matchingItem) {
            matchingItem.onSave(content);
        }
    }
}

class ConnectionItem extends vscode.TreeItem {
    constructor(label, parent, position) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this._children = [];
        this._document = undefined;

        if (parent) {
            this.contextValue = "File"
            this.projectID = parent.projectID;
            this._position = position;

            this.command = {
                title: label,
                command: 'connectionView.openDocument',
                arguments: [this]
            };
        } else {
            this.contextValue = "Project"
            this.projectID = label;
            this._position = undefined;
        }
    }

    add_child(child, position) {
        if (this._children.some(element => child == element.label)) {
            return
        }
        if (this.collapsibleState == vscode.TreeItemCollapsibleState.None) {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }
        this._children.push(new ConnectionItem(child, this, position));
    }

    async refresh() {
        const oldChildren = this._children;
        this._children = [];
        if (this.contextValue == "Project") {
            await fetch(`http://localhost:8080/${this.projectID}/files`, {
                method: 'GET'
            }).then(
                result => result.json()
            ).then(
                // @ts-ignore
                data => data.forEach((file, position) => { this.add_child(file, position) })
            ).catch(
                error => {
                    this._children = oldChildren;
                    error => vscode.window.showErrorMessage("Failed to Connect to PMC-Vis.\nIs the backend running?\n\n" + error)
                    return false;
                } // Handle the error response object
            );
        }
        return true;
    }

    async uploadFile(call) {

        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            var data = new FormData();
            const path = activeEditor.document.uri.path
            const fileName = path.split('\\').pop().split('/').pop();
            const fileContent = activeEditor.document.getText();
            const blob = new Blob([fileContent], { type: 'text/plain' });

            data.append('file', blob, fileName);

            await fetch(`http://localhost:8080/${this.projectID}/${call}`, { // Your POST endpoint
                method: 'POST',
                body: data // This is your file object
            }).then(
                success => console.log(success) // Handle the success response object
            ).catch(
                error => vscode.window.showErrorMessage("Failed to Connect to PMC-Vis.\nIs the backend running?\n\n" + error) // Handle the error response object
            );
        }
    }

    openFrontend() {
        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:3000/?id=${this.projectID}`));
    }

    async openDocument() {
        if (this.contextValue == "File") {
            if (!this._document) {
                await fetch(`http://localhost:8080/${this.projectID}/file:${this._position}`, {
                    method: 'GET'
                }).then(
                    result => result.json()
                ).then(
                    // @ts-ignore
                    async data => {
                        const uri = vscode.Uri.parse(`virtual:/${this.projectID}/${data['name']}`);
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(data['content']));
                        this._document = await vscode.workspace.openTextDocument(uri);
                    }).catch(
                        error => vscode.window.showErrorMessage(error) // Handle the error response object
                    );
            }
            await vscode.window.showTextDocument(this._document)

            return this._document
        }
    }

    async saveAsLocalFile() {
        if (this.contextValue = "File") {
            const workspace = vscode.workspace.workspaceFolders;
            const defaultPath = workspace ? `${workspace[0].uri.path}/${String(this.label)}` : String(this.label)
            console.log(defaultPath);
            vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultPath) }).then(
                async uri => {
                    if (uri) {
                        const document = await this.openDocument()
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(document.getText()));
                    }
                }
            )
        }
    }

    getUri() {
        if (this._document) {
            return this._document.uri;
        } else {
            return undefined;
        }
    }

    async onSave(content) {
        let call;
        switch (String(this._document.languageId)) {
            case "mdp":
                call = "upload-model";
                break;
            case "props":
                call = "upload-properties";
                break;
            default:
                vscode.window.showInformationMessage("File not recognized")
                return
        }

        var data = new FormData();
        const path = this._document.uri.path
        const fileName = path.split('\\').pop().split('/').pop();
        const fileContent = content;
        const blob = new Blob([fileContent], { type: 'text/plain' });

        data.append('file', blob, fileName);

        await fetch(`http://localhost:8080/${this.projectID}/${call}`, { // Your POST endpoint
            method: 'POST',
            body: data // This is your file object
        }).then(
            success => console.log(success) // Handle the success response object
        ).catch(
            error => console.log(error) // Handle the error response object
        );

        console.log("Saved ", this.label)
    }

    refreshDecorations() {

    }

}

module.exports = { ConnectionViewProvider }