const vscode = require('vscode');

//Decorations in TextEditor
const decorations = require("./decorations.js");
const constants = require("./constants.js");

class ConnectionViewProvider {

    constructor(decorator) {
        this._openProjects = [];
        this._decorator = decorator;

        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    async addProject() {
        const id = await vscode.window.showInputBox();
        if (!id) {
            return;
        }

        this._openProjects.push(new ConnectionItem(id));
        vscode.workspace.fs.createDirectory(vscode.Uri.parse(`virtual:/${id}`));
        this.refresh();
    }

    async addExistingProjects() {
        await fetch(`http://${constants.ADDRESS}:8080/0/projects`, {
            method: 'GET'
        }).then(
            result => result.json()
        ).then(
            // @ts-ignore
            data => data.forEach(file => {
                this._openProjects.push(new ConnectionItem(file));
                vscode.workspace.fs.createDirectory(vscode.Uri.parse(`virtual:/${file}`));
            })
        ).catch(
            error => {
                vscode.window.showErrorMessage("Failed to Connect to PMC-Vis.\nIs the backend running?\n\n" + error)
                return false;
            } // Handle the error response object
        );

        this.refresh();
    }

    removeProject(projectID) {
        this._openProjects = this._openProjects.filter(item => item._projectID != projectID);
        this.refresh();
    }

    removeProjects() {
        this._openProjects = [];
        this.refresh();
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
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "Loading Projects"
        }, async progress => {
            return Promise.all(this._openProjects.map(async project => {
                await project.refresh()
            }))
        })
        this._onDidChangeTreeData.fire(undefined);
    }

    updateText(document) {
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor) {
            if (document == null) {
                document = activeEditor.document;
            }

            if (document === activeEditor.document) {
                if (document.languageId == "mdp" && document.uri.scheme == "virtual") {
                    const project = document.uri.path.split("/")[1];

                    console.log("register " + project)
                    this._decorator.register(project);
                    this._decorator.parseDocument(activeEditor);
                    this._decorator.updateInfo(activeEditor);
                }
            }
        }
    }

    updateState(id, states) {
        this._decorator.updateStates(states, id);

        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor) {
            const document = activeEditor.document;
            if (document.languageId == "mdp" && document.uri.scheme == "virtual" && this._decorator.checkRegistration(id)) {
                console.log(id)
                this._decorator.updateInfo(activeEditor);
            }
        }
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
        this._saving = true;

        if (parent) {
            this.contextValue = "File"
            this.projectID = parent.projectID;
            this._position = position;
            this.openDocument(false);

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
            await fetch(`http://${constants.ADDRESS}:8080/${this.projectID}/files`, {
                method: 'GET'
            }).then(
                result => result.json()
            ).then(
                // @ts-ignore
                data => data.forEach((file, position) => { this.add_child(file, position) })
            ).catch(
                error => {
                    this._children = oldChildren;
                    vscode.window.showErrorMessage("Failed to Connect to PMC-Vis.\nIs the backend running?\n\n" + error)
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

            await fetch(`http://${constants.ADDRESS}:8080/${this.projectID}/${call}`, { // Your POST endpoint
                method: 'POST',
                body: data // This is your file object
            }).then(
                async (response) => {
                    if (response.ok) {
                        //vscode.window.showInformationMessage(response.statusText) // Handle the success response object
                        console.log("Uploaded", this.label)
                    } else {
                        const t = await response.text();
                        throw new Error(`Error: ${t}`);
                    }
                }).catch(
                    error => { vscode.window.showErrorMessage(error.message) } // Handle the error response object
                );
        }
    }

    openFrontend() {
        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:3000/?id=${this.projectID}`));
    }

    async openDocument(show = true) {
        if (this.contextValue == "File") {
            if (!this._document) {
                await fetch(`http://${constants.ADDRESS}:8080/${this.projectID}/file:${this._position}`, {
                    method: 'GET'
                }).then(
                    result => result.json()
                ).then(
                    // @ts-ignore
                    async data => {
                        const uri = vscode.Uri.parse(`virtual:/${this.projectID}/${data['name']}`);
                        this._saving = false;
                        await vscode.workspace.fs.writeFile(uri, Buffer.from(data['content']));
                        this._document = await vscode.workspace.openTextDocument(uri);
                        this.resourceUri = uri;
                        this._saving = true;
                    }).catch(
                        error => vscode.window.showErrorMessage(error)
                    );
            }
            if (show) {
                await vscode.window.showTextDocument(this._document)
            }
            return this._document
        }
    }

    async saveAsLocalFile() {
        if (this.contextValue = "File") {
            const workspace = vscode.workspace.workspaceFolders;
            const defaultPath = workspace ? `${workspace[0].uri.path}/${String(this.label)}` : String(this.label)
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
        if (this._saving)
            if (await vscode.window.showInformationMessage("Are you sure you want to save a new file? This will rebuild the model.", "Yes", "No") == "No") {
                return
            }
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
        await fetch(`http://${constants.ADDRESS}:8080/${this.projectID}/${call}`, {
            method: 'POST',
            body: data
        }).then(
            async (response) => {
                if (response.ok) {
                    //vscode.window.showInformationMessage(response.statusText)
                    console.log("Saved ", this.label)
                } else {
                    const t = await response.text();
                    throw new Error(`Error: ${t}`);
                }
            }).catch(
                error => vscode.window.showErrorMessage(error.message)
            );
    }

    refreshDecorations() {

    }

}

module.exports = { ConnectionViewProvider }