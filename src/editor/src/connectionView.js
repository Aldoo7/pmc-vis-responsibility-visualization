const vscode = require('vscode');

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
        this._onDidChangeTreeData.fire(undefined);
    }

    removeProject(projectID) {
        this._openProjects = this._openProjects.filter(item => item._projectID != projectID);
        this._onDidChangeTreeData.fire(undefined);
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
        return this._openProjects.find(project => element.id == project.id)
    }

    uploadFile(element) {
        let activeEditor = vscode.window.activeTextEditor
        const project = this.getProject(element);
        if (activeEditor && project) {
            switch (String(activeEditor.document.languageId)) {
                case "mdp":
                    project.uploadFile("upload-model");
                    break;
                case "props":
                    project.uploadFile("upload-properties");
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
    }

    openFrontend(element) {
        const project = this.getProject(element);
        if (project) {
            project.openFrontend()
        }
    }

}

class ConnectionItem extends vscode.TreeItem {
    constructor(projectID) {
        super(projectID, vscode.TreeItemCollapsibleState.None);
        this._projectID = projectID;
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

            await fetch(`http://localhost:8080/${this._projectID}/${call}`, { // Your POST endpoint
                method: 'POST',
                body: data // This is your file object
            }).then(
                success => console.log(success) // Handle the success response object
            ).catch(
                error => console.log(error) // Handle the error response object
            );
        }
    }

    openFrontend() {
        vscode.env.openExternal(vscode.Uri.parse(`http://localhost:3000/?id=${this._projectID}`));
    }
}

module.exports = { ConnectionViewProvider, ConnectionItem }