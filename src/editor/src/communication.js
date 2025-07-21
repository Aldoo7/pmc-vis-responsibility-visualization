const { io } = require("socket.io-client");
const constants = require("./constants.js");

class Communication {

    constructor() {
        const address = `http://${constants.ADDRESS}:8082`
        this._socket = io(address);

        console.log("opened socket on " + address)

        this._socket.on("connect", () => {
            console.log("Connected to backend")
        })

        this._socket.on("disconnect", (reason, details) => {
            console.log(reason)
        })

        this._socket.on(constants.EVENT_STATUS, (data) => {
            console.log(data)
        })
    }

    send(event, data) {
        this._socket.emit(event, data)
    }
}

module.exports = { Communication }