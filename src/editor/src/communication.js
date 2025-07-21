const { io } = require("socket.io-client");
const constants = require("./constants.js");

class Communication {

    constructor() {
        const address = `http://${constants.ADDRESS}:8081`

        this._socket = io(address);

        console.log("opened socket on " + address)

        this._socket.on("connect", () => {
            console.log("Connected to backend")
        })

        this._socket.on("disconnect", (reason, details) => {
            console.log(reason)
        })
    }

    send(message) {
        this._socket.emit("MESSAGE", message)
    }
}

module.exports = { Communication }