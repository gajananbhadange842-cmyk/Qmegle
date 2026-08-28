const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

// =====================================
// WEBSITE FILES
// =====================================

app.use(express.static(__dirname));

// =====================================
// GOOGLE SEARCH CONSOLE VERIFICATION
// =====================================

app.get("/googlea552bb0021f0b836.html", (req, res) => {
    res
        .type("html")
        .send("google-site-verification: googlea552bb0021f0b836.html");
});

// =====================================
// WAITING USER
// =====================================

let waitingUser = null;

// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {

    console.log("=================================");
    console.log("User connected:", socket.id);
    console.log("=================================");

    // =================================
    // FIND PARTNER
    // =================================

    socket.on("findPartner", () => {

        console.log("Find partner:", socket.id);

        // Already connected
        if (socket.partner) {
            return;
        }

        // Remove stale waiting user
        if (
            waitingUser &&
            !io.sockets.sockets.has(waitingUser)
        ) {
            waitingUser = null;
        }

        // Find waiting partner
        if (
            waitingUser &&
            waitingUser !== socket.id
        ) {

            const partnerId = waitingUser;

            const partnerSocket =
                io.sockets.sockets.get(partnerId);

            waitingUser = null;

            if (partnerSocket) {

                socket.partner = partnerId;
                partnerSocket.partner = socket.id;

                // First user becomes initiator
                socket.emit("matched", {
                    partner: partnerId,
                    initiator: true
                });

                partnerSocket.emit("matched", {
                    partner: socket.id,
                    initiator: false
                });

                console.log(
                    "MATCHED:",
                    socket.id,
                    "<->",
                    partnerId
                );

            } else {

                waitingUser = socket.id;

                socket.emit("waiting");
            }

        } else {

            waitingUser = socket.id;

            socket.emit("waiting");

            console.log(
                "WAITING:",
                socket.id
            );
        }
    });

    // =================================
    // WEBRTC SIGNAL
    // =================================

    socket.on("signal", (data) => {

        if (!socket.partner) {
            return;
        }

        if (!data) {
            return;
        }

        const partnerSocket =
            io.sockets.sockets.get(socket.partner);

        if (!partnerSocket) {
            return;
        }

        partnerSocket.emit("signal", {
            from: socket.id,
            signal: data
        });
    });

    // =================================
    // TEXT CHAT
    // =================================

    socket.on("chatMessage", (message) => {

        if (!socket.partner) {
            return;
        }

        if (
            typeof message !== "string" ||
            !message.trim()
        ) {
            return;
        }

        const partnerSocket =
            io.sockets.sockets.get(socket.partner);

        if (partnerSocket) {

            partnerSocket.emit(
                "chatMessage",
                message.trim()
            );
        }
    });

    // =================================
    // NEXT
    // =================================

    socket.on("next", () => {

        console.log(
            "NEXT:",
            socket.id
        );

        // Remove from waiting
        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        // Save old partner
        const oldPartnerId =
            socket.partner;

        // Remove own partner
        socket.partner = null;

        // Disconnect old partner
        if (oldPartnerId) {

            const partnerSocket =
                io.sockets.sockets.get(
                    oldPartnerId
                );

            if (partnerSocket) {

                partnerSocket.partner = null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }

        // Find a new partner
        findNewPartner(socket);
    });

    // =================================
    // STOP
    // =================================

    socket.on("stop", () => {

        console.log(
            "STOP:",
            socket.id
        );

        // Remove from waiting
        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        const oldPartnerId =
            socket.partner;

        socket.partner = null;

        // Tell partner
        if (oldPartnerId) {

            const partnerSocket =
                io.sockets.sockets.get(
                    oldPartnerId
                );

            if (partnerSocket) {

                partnerSocket.partner = null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }
    });

    // =================================
    // REPORT USER
    // =================================

    socket.on("reportUser", (reportData) => {

        console.log("");
        console.log("=================================");
        console.log("REPORT");
        console.log("Reporter:", socket.id);
        console.log(
            "Reported user:",
            socket.partner || "none"
        );
        console.log(
            "Report:",
            reportData
        );
        console.log("=================================");
        console.log("");
    });

    // =================================
    // DISCONNECT
    // =================================

    socket.on("disconnect", () => {

        console.log(
            "User disconnected:",
            socket.id
        );

        // Remove from waiting
        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        // Notify partner
        const partnerId =
            socket.partner;

        if (partnerId) {

            const partnerSocket =
                io.sockets.sockets.get(
                    partnerId
                );

            if (partnerSocket) {

                partnerSocket.partner = null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }
    });
});

// =====================================
// FIND NEW PARTNER
// =====================================

function findNewPartner(socket) {

    console.log(
        "Finding new partner:",
        socket.id
    );

    // Remove stale waiting user
    if (
        waitingUser &&
        !io.sockets.sockets.has(waitingUser)
    ) {
        waitingUser = null;
    }

    // Someone is waiting
    if (
        waitingUser &&
        waitingUser !== socket.id
    ) {

        const partnerId =
            waitingUser;

        const partnerSocket =
            io.sockets.sockets.get(
                partnerId
            );

        waitingUser = null;

        if (partnerSocket) {

            socket.partner =
                partnerId;

            partnerSocket.partner =
                socket.id;

            socket.emit("matched", {
                partner: partnerId,
                initiator: true
            });

            partnerSocket.emit("matched", {
                partner: socket.id,
                initiator: false
            });

            console.log(
                "NEW MATCH:",
                socket.id,
                "<->",
                partnerId
            );

        } else {

            waitingUser =
                socket.id;

            socket.emit("waiting");
        }

    } else {

        waitingUser =
            socket.id;

        socket.emit("waiting");

        console.log(
            "WAITING FOR NEW PARTNER:",
            socket.id
        );
    }
}

// =====================================
// START SERVER
// =====================================

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "================================="
        );
        console.log(
            "🚀 Qmegle Server Started"
        );
        console.log(
            "🌐 Port:",
            PORT
        );
        console.log(
            "🔎 Google verification enabled"
        );
        console.log(
            "================================="
        );
        console.log("");
    }
);
