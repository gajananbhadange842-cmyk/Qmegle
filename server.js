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
// REPORT SETTINGS
// =====================================

const allowedReportReasons = [
    "Sexual / Adult Content",
    "Harassment",
    "Abuse",
    "Spam",
    "Other"
];

// Prevent repeated reports from same user
const reportCooldown = new Map();

const REPORT_COOLDOWN_MS = 30 * 1000;

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

        if (socket.partner) {
            return;
        }

        if (
            waitingUser &&
            !io.sockets.sockets.has(waitingUser)
        ) {
            waitingUser = null;
        }

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

        // Limit message length
        const cleanMessage =
            message.trim().slice(0, 1000);

        const partnerSocket =
            io.sockets.sockets.get(socket.partner);

        if (partnerSocket) {

            partnerSocket.emit(
                "chatMessage",
                cleanMessage
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

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        const oldPartnerId =
            socket.partner;

        socket.partner = null;

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

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        const oldPartnerId =
            socket.partner;

        socket.partner = null;

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

        const reportedUser =
            socket.partner;

        // Must have an active partner
        if (!reportedUser) {

            console.log(
                "REPORT BLOCKED: No partner",
                socket.id
            );

            return;
        }

        // Validate report data
        if (
            !reportData ||
            typeof reportData.reason !== "string"
        ) {

            console.log(
                "REPORT BLOCKED: Invalid data",
                socket.id
            );

            return;
        }

        const reason =
            reportData.reason.trim();

        // Only allow known reasons
        if (
            !allowedReportReasons.includes(reason)
        ) {

            console.log(
                "REPORT BLOCKED: Invalid reason",
                reason
            );

            return;
        }

        // Report cooldown
        const lastReport =
            reportCooldown.get(socket.id);

        if (
            lastReport &&
            Date.now() - lastReport <
            REPORT_COOLDOWN_MS
        ) {

            console.log(
                "REPORT BLOCKED: Cooldown",
                socket.id
            );

            return;
        }

        reportCooldown.set(
            socket.id,
            Date.now()
        );

        // =================================
        // SAVE REPORT IN SERVER MEMORY
        // =================================

        const report = {

            reporterId:
                socket.id,

            reportedUserId:
                reportedUser,

            reason:
                reason,

            timestamp:
                new Date().toISOString()
        };

        console.log("");
        console.log("=================================");
        console.log("🚨 QMEGLE REPORT");
        console.log("Reporter:", report.reporterId);
        console.log(
            "Reported User:",
            report.reportedUserId
        );
        console.log(
            "Reason:",
            report.reason
        );
        console.log(
            "Time:",
            report.timestamp
        );
        console.log("=================================");
        console.log("");

        // =================================
        // DISCONNECT BOTH USERS
        // =================================

        const partnerSocket =
            io.sockets.sockets.get(
                reportedUser
            );

        socket.partner = null;

        if (partnerSocket) {

            partnerSocket.partner = null;

            partnerSocket.emit(
                "partnerDisconnected"
            );
        }

        socket.emit(
            "reportAccepted"
        );
    });

    // =================================
    // DISCONNECT
    // =================================

    socket.on("disconnect", () => {

        console.log(
            "User disconnected:",
            socket.id
        );

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        // Remove cooldown memory
        reportCooldown.delete(socket.id);

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

    if (
        waitingUser &&
        !io.sockets.sockets.has(waitingUser)
    ) {
        waitingUser = null;
    }

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
            "🛡️ Report protection enabled"
        );

        console.log(
            "================================="
        );

        console.log("");
    }
);
