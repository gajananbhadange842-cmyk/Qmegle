```javascript
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// =====================================
// WEBSITE FILES
// =====================================

app.use(express.static(__dirname));

// =====================================
// MAIN QMEGLE PAGE
// =====================================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// =====================================
// SEO PAGES
// =====================================

app.get("/random-video-chat", (req, res) => {
    res.sendFile(path.join(__dirname, "random-video-chat.html"));
});

app.get("/free-video-chat", (req, res) => {
    res.sendFile(path.join(__dirname, "free-video-chat.html"));
});

app.get("/chat-with-strangers", (req, res) => {
    res.sendFile(path.join(__dirname, "chat-with-strangers.html"));
});

app.get("/random-text-chat", (req, res) => {
    res.sendFile(path.join(__dirname, "random-text-chat.html"));
});

app.get("/omegle-alternative", (req, res) => {
    res.sendFile(path.join(__dirname, "omegle-alternative.html"));
});

// =====================================
// RANDOM USER MATCHING
// =====================================

let waitingUser = null;

io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    // =================================
    // FIND RANDOM PARTNER
    // =================================

    socket.on("find-partner", () => {

        if (waitingUser && waitingUser !== socket.id) {

            const partner = waitingUser;
            waitingUser = null;

            io.to(socket.id).emit("partner-found", {
                partnerId: partner,
                initiator: true
            });

            io.to(partner).emit("partner-found", {
                partnerId: socket.id,
                initiator: false
            });

            console.log(
                "Matched:",
                socket.id,
                "<->",
                partner
            );

        } else {

            waitingUser = socket.id;

            socket.emit("waiting");

            console.log(
                "User waiting:",
                socket.id
            );
        }
    });

    // =================================
    // WEBRTC SIGNALING
    // =================================

    socket.on("signal", (data) => {

        if (!data || !data.to) {
            return;
        }

        io.to(data.to).emit("signal", {
            from: socket.id,
            signal: data.signal
        });
    });

    // =================================
    // CHAT MESSAGE
    // =================================

    socket.on("chat-message", (data) => {

        if (!data || !data.to) {
            return;
        }

        io.to(data.to).emit("chat-message", {
            message: data.message
        });
    });

    // =================================
    // NEXT PARTNER
    // =================================

    socket.on("next", () => {

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        socket.emit("next-ready");
    });

    // =================================
    // DISCONNECT
    // =================================

    socket.on("disconnect", () => {

        if (waitingUser === socket.id) {
            waitingUser = null;
        }

        console.log(
            "User disconnected:",
            socket.id
        );
    });

});

// =====================================
// SERVER PORT
// =====================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log("=================================");
    console.log("Qmegle Server Started");
    console.log("Port:", PORT);
    console.log("=================================");

});
```
