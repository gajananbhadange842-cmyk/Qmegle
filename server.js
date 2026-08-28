const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server);

app.use(express.static(__dirname));

let waitingUser = null;

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    socket.on("findPartner", () => {

        if (socket.partner) return;

        if (
            waitingUser &&
            waitingUser !== socket.id &&
            io.sockets.sockets.has(waitingUser)
        ) {

            const partnerSocket =
                io.sockets.sockets.get(waitingUser);

            waitingUser = null;

            socket.partner = partnerSocket.id;
            partnerSocket.partner = socket.id;

            socket.emit("matched", partnerSocket.id);
            partnerSocket.emit("matched", socket.id);

            console.log(
                "MATCHED:",
                socket.id,
                "<->",
                partnerSocket.id
            );

        } else {

            waitingUser = socket.id;

            socket.emit("waiting");

            console.log(
                "WAITING:",
                socket.id
            );
        }
    });

    socket.on("signal", (data) => {

        if (!socket.partner) return;

        const partnerSocket =
            io.sockets.sockets.get(socket.partner);

        if (partnerSocket) {

            partnerSocket.emit("signal", {
                from: socket.id,
                signal: data
            });
        }
    });

    socket.on("chatMessage", (message) => {

        if (!socket.partner) return;

        const partnerSocket =
            io.sockets.sockets.get(socket.partner);

        if (partnerSocket) {

            partnerSocket.emit(
                "chatMessage",
                message
            );
        }
    });

    socket.on("next", () => {

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        const oldPartnerId = socket.partner;

        socket.partner = null;

        if (oldPartnerId) {

            const partnerSocket =
                io.sockets.sockets.get(oldPartnerId);

            if (partnerSocket) {

                partnerSocket.partner = null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }

        findNewPartner(socket);
    });

    socket.on("stop", () => {

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        const oldPartnerId = socket.partner;

        socket.partner = null;

        if (oldPartnerId) {

            const partnerSocket =
                io.sockets.sockets.get(oldPartnerId);

            if (partnerSocket) {

                partnerSocket.partner = null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }

        console.log(
            "STOP:",
            socket.id
        );
    });

    socket.on("reportUser", (reportData) => {

        console.log(
            "REPORT:",
            socket.id,
            reportData
        );
    });

    socket.on("disconnect", () => {

        console.log(
            "User disconnected:",
            socket.id
        );

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        const partnerId = socket.partner;

        if (partnerId) {

            const partnerSocket =
                io.sockets.sockets.get(partnerId);

            if (partnerSocket) {

                partnerSocket.partner = null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }
    });
});

function findNewPartner(socket) {

    if (
        waitingUser &&
        waitingUser !== socket.id &&
        io.sockets.sockets.has(waitingUser)
    ) {

        const partnerSocket =
            io.sockets.sockets.get(waitingUser);

        waitingUser = null;

        socket.partner = partnerSocket.id;
        partnerSocket.partner = socket.id;

        socket.emit("matched", partnerSocket.id);

        partnerSocket.emit(
            "matched",
            socket.id
        );

        console.log(
            "NEW MATCH:",
            socket.id,
            "<->",
            partnerSocket.id
        );

    } else {

        waitingUser = socket.id;

        socket.emit("waiting");

        console.log(
            "WAITING:",
            socket.id
        );
    }
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {

    console.log(
        "Qmegle server running on port " + PORT
    );
});
