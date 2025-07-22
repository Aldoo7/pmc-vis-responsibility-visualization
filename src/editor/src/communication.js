const vscode = require('vscode');

const { io } = require("socket.io-client");
const constants = require("./constants.js");

class Communication {

    constructor(statusBarItem) {
        this._status = statusBarItem;

        const address = `http://${constants.ADDRESS}:8082`
        this._socket = io(address);

        console.log("opened socket on " + address)

        this._socket.on("connect", () => {
            this.updateStatusBar("Connected", null)
        })

        this._socket.on("disconnect", (reason, details) => {
            //vscode.window.showWarningMessage("Socket Disconnected\n Reason: " + reason);
            this.updateStatusBar("Disonnected", new vscode.ThemeColor('statusBarItem.errorBackground'))
        })

        this._socket.on("connect_error", () => {
            this.updateStatusBar("Connection Failed", new vscode.ThemeColor('statusBarItem.errorBackground'))
        });

        this._socket.on(constants.EVENT_STATUS, (data) => {
            this.updateStatusBar(data, null)
        })

        this._socket.on("MESSAGE", (data) => {
            vscode.window.showInformationMessage("Someone says: " + data);
        })
    }

    send(event, data) {
        this._socket.emit(event, data)
    }

    register(event, handler) {
        this._socket.on(event, handler);
    }

    updateStatusBar(text, color) {
        this._status.text = text;
        this._status.color = color;
        this._status.show();
    }

    emptyStatusBar() {
        this._status.hide();
    }
}

module.exports = { Communication }