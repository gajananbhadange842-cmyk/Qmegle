require("dotenv").config();

const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(__dirname));

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

// =====================================
// GOOGLE SEARCH CONSOLE VERIFICATION
// =====================================

app.get("/googlea552bb0021f0b836.html", (req, res) => {
    res
        .type("html")
        .send("google-site-verification: googlea552bb0021f0b836.html");
});

// =====================================
// MONGODB
// =====================================

const mongoUri = process.env.MONGODB_URI;

let mongoClient = null;
let reportsCollection = null;

async function connectMongoDB() {

    try {

        if (!mongoUri) {
            console.log("❌ MONGODB_URI missing in .env");
            return;
        }

        mongoClient = new MongoClient(mongoUri);

        await mongoClient.connect();

        const db =
            mongoClient.db("qmegle");

        reportsCollection =
            db.collection("reports");

        console.log("=================================");
        console.log("✅ MongoDB Connected");
        console.log("📁 Database: qmegle");
        console.log("📁 Collection: reports");
        console.log("=================================");

    } catch (error) {

        console.error(
            "❌ MongoDB Error:",
            error.message
        );
    }
}

// =====================================
// ADMIN AUTHENTICATION
// =====================================

const adminPassword =
    process.env.ADMIN_PASSWORD;

const adminTokens =
    new Map();

function createAdminToken() {

    return crypto.randomBytes(32).toString("hex");
}

function isAdmin(req) {

    const auth =
        req.headers.authorization || "";

    if (!auth.startsWith("Bearer ")) {
        return false;
    }

    const token =
        auth.substring(7);

    return adminTokens.has(token);
}

// =====================================
// ADMIN LOGIN
// =====================================

app.post("/admin/login", (req, res) => {

    const password =
        req.body?.password;

    if (!adminPassword) {

        return res.status(500).json({
            error:
                "ADMIN_PASSWORD is not configured."
        });
    }

    if (
        typeof password !== "string" ||
        password !== adminPassword
    ) {

        return res.status(401).json({
            error:
                "Wrong admin password."
        });
    }

    const token =
        createAdminToken();

    adminTokens.set(
        token,
        Date.now()
    );

    console.log(
        "🔐 Admin login successful"
    );

    res.json({
        success: true,
        token: token
    });
});

// =====================================
// ADMIN REPORTS
// =====================================

app.get("/admin/reports", async (req, res) => {

    if (!isAdmin(req)) {

        return res.status(401).json({
            error:
                "Unauthorized"
        });
    }

    try {

        if (!reportsCollection) {

            return res.status(503).json({
                error:
                    "MongoDB is not connected."
            });
        }

        const reports =
            await reportsCollection
            .find({})
            .sort({
                timestamp: -1
            })
            .limit(500)
            .toArray();

        res.json({
            success: true,
            reports: reports
        });

    } catch (error) {

        console.error(
            "Reports error:",
            error.message
        );

        res.status(500).json({
            error:
                "Could not load reports."
        });
    }
});

// =====================================
// MARK REPORT REVIEWED
// =====================================

app.post(
    "/admin/reports/:id/review",
    async (req, res) => {

        if (!isAdmin(req)) {

            return res.status(401).json({
                error:
                    "Unauthorized"
            });
        }

        try {

            if (!reportsCollection) {

                return res.status(503).json({
                    error:
                        "MongoDB is not connected."
                });
            }

            const id =
                req.params.id;

            if (!ObjectId.isValid(id)) {

                return res.status(400).json({
                    error:
                        "Invalid report ID."
                });
            }

            await reportsCollection.updateOne(
                {
                    _id:
                        new ObjectId(id)
                },
                {
                    $set: {
                        status:
                            "reviewed",
                        reviewedAt:
                            new Date()
                    }
                }
            );

            res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "Review error:",
                error.message
            );

            res.status(500).json({
                error:
                    "Could not update report."
            });
        }
    }
);

// =====================================
// DELETE REPORT
// =====================================

app.delete(
    "/admin/reports/:id",
    async (req, res) => {

        if (!isAdmin(req)) {

            return res.status(401).json({
                error:
                    "Unauthorized"
            });
        }

        try {

            if (!reportsCollection) {

                return res.status(503).json({
                    error:
                        "MongoDB is not connected."
                });
            }

            const id =
                req.params.id;

            if (!ObjectId.isValid(id)) {

                return res.status(400).json({
                    error:
                        "Invalid report ID."
                });
            }

            await reportsCollection.deleteOne(
                {
                    _id:
                        new ObjectId(id)
                }
            );

            res.json({
                success: true
            });

        } catch (error) {

            console.error(
                "Delete error:",
                error.message
            );

            res.status(500).json({
                error:
                    "Could not delete report."
            });
        }
    }
);

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

const reportCooldown =
    new Map();

const REPORT_COOLDOWN_MS =
    30 * 1000;

// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {

    console.log(
        "User connected:",
        socket.id
    );

    // =================================
    // FIND PARTNER
    // =================================

    socket.on("findPartner", () => {

        if (socket.partner) {
            return;
        }

        if (
            waitingUser &&
            !io.sockets.sockets.has(
                waitingUser
            )
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
                    partner:
                        partnerId,
                    initiator:
                        true
                });

                partnerSocket.emit(
                    "matched",
                    {
                        partner:
                            socket.id,
                        initiator:
                            false
                    }
                );

                console.log(
                    "MATCHED:",
                    socket.id,
                    "<->",
                    partnerId
                );

            } else {

                waitingUser =
                    socket.id;

                socket.emit(
                    "waiting"
                );
            }

        } else {

            waitingUser =
                socket.id;

            socket.emit(
                "waiting"
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
            io.sockets.sockets.get(
                socket.partner
            );

        if (!partnerSocket) {
            return;
        }

        partnerSocket.emit(
            "signal",
            {
                from:
                    socket.id,
                signal:
                    data
            }
        );
    });

    // =================================
    // TEXT CHAT
    // =================================

    socket.on(
        "chatMessage",
        (message) => {

            if (!socket.partner) {
                return;
            }

            if (
                typeof message !==
                "string" ||
                !message.trim()
            ) {
                return;
            }

            const cleanMessage =
                message
                .trim()
                .slice(0, 1000);

            const partnerSocket =
                io.sockets.sockets.get(
                    socket.partner
                );

            if (partnerSocket) {

                partnerSocket.emit(
                    "chatMessage",
                    cleanMessage
                );
            }
        }
    );

    // =================================
    // NEXT
    // =================================

    socket.on("next", () => {

        if (
            waitingUser ===
            socket.id
        ) {

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

                partnerSocket.partner =
                    null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }

        findNewPartner(
            socket
        );
    });

    // =================================
    // STOP
    // =================================

    socket.on("stop", () => {

        if (
            waitingUser ===
            socket.id
        ) {

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

                partnerSocket.partner =
                    null;

                partnerSocket.emit(
                    "partnerDisconnected"
                );
            }
        }
    });

    // =================================
    // REPORT
    // =================================

    socket.on(
        "reportUser",
        async (reportData) => {

            try {

                const reportedUser =
                    socket.partner;

                if (!reportedUser) {
                    return;
                }

                if (
                    !reportData ||
                    typeof reportData.reason !==
                    "string"
                ) {
                    return;
                }

                const reason =
                    reportData.reason.trim();

                if (
                    !allowedReportReasons
                    .includes(reason)
                ) {
                    return;
                }

                const lastReport =
                    reportCooldown.get(
                        socket.id
                    );

                if (
                    lastReport &&
                    Date.now() -
                    lastReport <
                    REPORT_COOLDOWN_MS
                ) {

                    return;
                }

                reportCooldown.set(
                    socket.id,
                    Date.now()
                );

                const report = {

                    reporterId:
                        socket.id,

                    reportedUserId:
                        reportedUser,

                    reason:
                        reason,

                    timestamp:
                        new Date(),

                    status:
                        "new"
                };

                if (
                    reportsCollection
                ) {

                    await reportsCollection
                        .insertOne(
                            report
                        );

                    console.log(
                        "🚨 Report saved to MongoDB"
                    );
                }

                const partnerSocket =
                    io.sockets.sockets.get(
                        reportedUser
                    );

                socket.partner =
                    null;

                if (partnerSocket) {

                    partnerSocket.partner =
                        null;

                    partnerSocket.emit(
                        "partnerDisconnected"
                    );
                }

                socket.emit(
                    "reportAccepted"
                );

            } catch (error) {

                console.error(
                    "Report error:",
                    error.message
                );
            }
        }
    );

    // =================================
    // DISCONNECT
    // =================================

    socket.on(
        "disconnect",
        () => {

            if (
                waitingUser ===
                socket.id
            ) {

                waitingUser = null;
            }

            reportCooldown.delete(
                socket.id
            );

            const partnerId =
                socket.partner;

            if (partnerId) {

                const partnerSocket =
                    io.sockets.sockets.get(
                        partnerId
                    );

                if (partnerSocket) {

                    partnerSocket.partner =
                        null;

                    partnerSocket.emit(
                        "partnerDisconnected"
                    );
                }
            }

            console.log(
                "User disconnected:",
                socket.id
            );
        }
    );
});

// =====================================
// FIND NEW PARTNER
// =====================================

function findNewPartner(socket) {

    if (
        waitingUser &&
        !io.sockets.sockets.has(
            waitingUser
        )
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

            socket.emit(
                "matched",
                {
                    partner:
                        partnerId,
                    initiator:
                        true
                }
            );

            partnerSocket.emit(
                "matched",
                {
                    partner:
                        socket.id,
                    initiator:
                        false
                }
            );

        } else {

            waitingUser =
                socket.id;

            socket.emit(
                "waiting"
            );
        }

    } else {

        waitingUser =
            socket.id;

        socket.emit(
            "waiting"
        );
    }
}

// =====================================
// START SERVER
// =====================================

const PORT =
    process.env.PORT || 3000;

async function startServer() {

    await connectMongoDB();

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
                "🛡️ Admin Panel Enabled"
            );

            console.log(
                "🗄️ MongoDB Reports Enabled"
            );

            console.log(
                "================================="
            );
        }
    );
}

startServer();
