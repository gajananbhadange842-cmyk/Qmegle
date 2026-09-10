// ==========================================
// QMEGLE SERVER - RANDOM CHAT / VIDEO CHAT
// Designed for high concurrent connections
// ==========================================

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// ==========================================
// EXPRESS SETTINGS
// ==========================================

app.disable("x-powered-by");

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "50kb" }));

// ==========================================
// SITEMAP.XML
// ==========================================

app.get("/sitemap.xml", (req, res) => {

    const sitemapPath = path.join(__dirname, "sitemap.xml");

    fs.readFile(sitemapPath, "utf8", (err, data) => {

        if (err) {

            console.error("SITEMAP ERROR:", err);

            return res
                .status(404)
                .type("text/plain")
                .send("Sitemap not found");
        }

        // Remove UTF-8 BOM if present
        data = data.replace(/^\uFEFF/, "");

        // Remove accidental Markdown code fences
        data = data.replace(/^```xml\s*/i, "");
        data = data.replace(/^```\s*/i, "");
        data = data.replace(/\s*```\s*$/i, "");

        // Remove anything before the XML declaration
        const xmlStart = data.indexOf("<?xml");

        if (xmlStart > 0) {
            data = data.substring(xmlStart);
        }

        // If XML declaration is missing, start from <urlset
        if (!data.trim().startsWith("<?xml")) {

            const urlsetStart = data.indexOf("<urlset");

            if (urlsetStart !== -1) {
                data = data.substring(urlsetStart);
            }
        }

        data = data.trim();

        // Basic XML validation
        if (
            !data.includes("<urlset") ||
            !data.includes("</urlset>")
        ) {

            console.error("INVALID SITEMAP XML");

            return res
                .status(500)
                .type("text/plain")
                .send("Invalid sitemap XML");
        }

        res.status(200);

        res.set(
            "Content-Type",
            "application/xml; charset=utf-8"
        );

        res.send(data);
    });
});

// ==========================================
// ROBOTS.TXT
// ==========================================

app.get("/robots.txt", (req, res) => {

    res.status(200);

    res.set(
        "Content-Type",
        "text/plain; charset=utf-8"
    );

    res.send(
        "User-agent: *\n" +
        "Allow: /\n" +
        "\n" +
        "Sitemap: https://qmegle.onrender.com/sitemap.xml"
    );
});

// ==========================================
// STATIC FILES
// ==========================================

app.use(express.static(path.join(__dirname), {
    extensions: ["html"],
    maxAge: "1h"
}));

// ==========================================
// SOCKET.IO
// ==========================================

const io = new Server(server, {

    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },

    transports: ["websocket", "polling"],

    pingInterval: 25000,

    pingTimeout: 60000,

    maxHttpBufferSize: 100000
});

// ==========================================
// USER MANAGEMENT
// ==========================================

const waitingUsers = [];

const partners = new Map();

let onlineUsers = 0;

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function removeFromWaiting(socketId) {

    const index = waitingUsers.indexOf(socketId);

    if (index !== -1) {

        waitingUsers.splice(index, 1);

        return true;
    }

    return false;
}

function getPartner(socketId) {

    return partners.get(socketId);
}

function setPartners(user1, user2) {

    partners.set(user1, user2);

    partners.set(user2, user1);
}

function removePartner(socketId) {

    const partnerId = partners.get(socketId);

    partners.delete(socketId);

    if (partnerId) {

        partners.delete(partnerId);
    }

    return partnerId;
}

// ==========================================
// FIND RANDOM PARTNER
// ==========================================

function findPartner(socket) {

    removeFromWaiting(socket.id);

    if (partners.has(socket.id)) {

        return;
    }

    while (waitingUsers.length > 0) {

        const partnerId = waitingUsers.shift();

        const partnerSocket =
            io.sockets.sockets.get(partnerId);

        if (!partnerSocket) {

            continue;
        }

        if (partnerId === socket.id) {

            continue;
        }

        if (partners.has(partnerId)) {

            continue;
        }

        setPartners(socket.id, partnerId);

        socket.emit("matched", {
            partnerId: partnerId
        });

        partnerSocket.emit("matched", {
            partnerId: socket.id
        });

        console.log(
            `MATCH: ${socket.id} <--> ${partnerId}`
        );

        return;
    }

    waitingUsers.push(socket.id);

    socket.emit("waiting");

    console.log(
        `WAITING: ${socket.id} | Queue: ${waitingUsers.length}`
    );
}

// ==========================================
// SOCKET CONNECTION
// ==========================================

io.on("connection", (socket) => {

    onlineUsers++;

    console.log(
        `CONNECTED: ${socket.id} | Online: ${onlineUsers}`
    );

    socket.emit(
        "onlineUsers",
        onlineUsers
    );

    io.emit(
        "onlineUsers",
        onlineUsers
    );

    // ======================================
    // START CHAT
    // ======================================

    socket.on("start", () => {

        findPartner(socket);
    });

    socket.on("startChat", () => {

        findPartner(socket);
    });

    // ======================================
    // NEXT USER
    // ======================================

    socket.on("next", () => {

        const oldPartnerId =
            removePartner(socket.id);

        removeFromWaiting(socket.id);

        if (oldPartnerId) {

            const oldPartner =
                io.sockets.sockets.get(oldPartnerId);

            if (oldPartner) {

                oldPartner.emit("partnerLeft");

                findPartner(oldPartner);
            }
        }

        findPartner(socket);
    });

    // ======================================
    // STOP CHAT
    // ======================================

    socket.on("stop", () => {

        removeFromWaiting(socket.id);

        const partnerId =
            removePartner(socket.id);

        if (partnerId) {

            const partner =
                io.sockets.sockets.get(partnerId);

            if (partner) {

                partner.emit("partnerLeft");
            }
        }

        socket.emit("stopped");
    });

    // ======================================
    // WEBRTC OFFER
    // ======================================

    socket.on("offer", (data) => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (!partner) return;

        partner.emit("offer", {
            offer: data.offer,
            from: socket.id
        });
    });

    // ======================================
    // WEBRTC ANSWER
    // ======================================

    socket.on("answer", (data) => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (!partner) return;

        partner.emit("answer", {
            answer: data.answer,
            from: socket.id
        });
    });

    // ======================================
    // WEBRTC ICE CANDIDATE
    // ======================================

    socket.on("ice-candidate", (data) => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (!partner) return;

        partner.emit("ice-candidate", {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // Alternative ICE event
    socket.on("candidate", (data) => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (!partner) return;

        partner.emit("candidate", {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // ======================================
    // TEXT MESSAGE
    // ======================================

    socket.on("message", (message) => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (!partner) return;

        if (typeof message !== "string") return;

        if (message.length > 2000) return;

        partner.emit(
            "message",
            message
        );
    });

    // Support chatMessage
    socket.on("chatMessage", (message) => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (!partner) return;

        if (typeof message !== "string") return;

        if (message.length > 2000) return;

        partner.emit(
            "chatMessage",
            message
        );
    });

    // ======================================
    // TYPING
    // ======================================

    socket.on("typing", () => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (partner) {

            partner.emit("typing");
        }
    });

    socket.on("stopTyping", () => {

        const partnerId =
            partners.get(socket.id);

        if (!partnerId) return;

        const partner =
            io.sockets.sockets.get(partnerId);

        if (partner) {

            partner.emit("stopTyping");
        }
    });

    // ======================================
    // DISCONNECT
    // ======================================

    socket.on("disconnect", (reason) => {

        onlineUsers--;

        if (onlineUsers < 0) {

            onlineUsers = 0;
        }

        console.log(
            `DISCONNECTED: ${socket.id} | Reason: ${reason}`
        );

        removeFromWaiting(socket.id);

        const partnerId =
            removePartner(socket.id);

        if (partnerId) {

            const partner =
                io.sockets.sockets.get(partnerId);

            if (partner) {

                partner.emit("partnerLeft");

                setTimeout(() => {

                    if (
                        io.sockets.sockets.has(partnerId) &&
                        !partners.has(partnerId)
                    ) {

                        findPartner(partner);
                    }

                }, 500);
            }
        }

        io.emit(
            "onlineUsers",
            onlineUsers
        );
    });

});

// ==========================================
// ONLINE USERS API
// ==========================================

app.get("/api/online", (req, res) => {

    res.json({
        online: onlineUsers
    });
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/health", (req, res) => {

    res.status(200).json({

        status: "ok",

        service: "Qmegle",

        onlineUsers: onlineUsers,

        waitingUsers: waitingUsers.length,

        activeChats: partners.size / 2,

        uptime: Math.floor(
            process.uptime()
        )
    });
});

// ==========================================
// MAIN PAGE
// ==========================================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "index.html"
        )
    );
});

// ==========================================
// SEO PAGES
// ==========================================

const seoPages = [

    "about",
    "contact",
    "privacy",
    "terms",

    "random-video-chat",
    "free-video-chat",
    "chat-with-strangers",
    "random-text-chat",
    "omegle-alternative",
    "free-random-chat"

];

seoPages.forEach((page) => {

    app.get(`/${page}`, (req, res) => {

        const filePath =
            path.join(
                __dirname,
                `${page}.html`
            );

        res.sendFile(
            filePath,
            (err) => {

                if (err) {

                    res.status(404)
                       .send("Page not found");
                }
            }
        );
    });
});

// ==========================================
// 404
// ==========================================

app.use((req, res) => {

    res.status(404)
       .send("Page not found");
});

// ==========================================
// ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {

    console.error(
        "SERVER ERROR:",
        err
    );

    res.status(500).json({

        error: "Internal server error"

    });
});

// ==========================================
// START SERVER
// ==========================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");

        console.log(
            "======================================"
        );

        console.log(
            "        QMEGLE SERVER STARTED"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            `Environment: ${
                process.env.NODE_ENV ||
                "production"
            }`
        );

        console.log(
            "Socket.IO: ENABLED"
        );

        console.log(
            "WebRTC Signaling: ENABLED"
        );

        console.log(
            "Random Matching: ENABLED"
        );

        console.log(
            "Online Users: ENABLED"
        );

        console.log(
            "Sitemap: ENABLED"
        );

        console.log(
            "Robots.txt: ENABLED"
        );

        console.log(
            "Health Check: /health"
        );

        console.log(
            "======================================"
        );

        console.log("");
    }
);
