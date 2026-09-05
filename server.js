const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// =====================================
// SOCKET.IO
// =====================================

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// =====================================
// PORT
// =====================================

const PORT = process.env.PORT || 3000;

// =====================================
// WEBSITE FILES
// =====================================

app.use(express.static(__dirname));

// =====================================
// BASIC ROUTES
// =====================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.status(200).send("Qmegle server is running");
});

// =====================================
// SEO PAGES
// =====================================

const seoPages = [
  "random-video-chat",
  "free-video-chat",
  "chat-with-strangers",
  "random-text-chat",
  "omegle-alternative",
  "free-random-chat"
];

seoPages.forEach((page) => {
  app.get("/" + page, (req, res) => {
    res.sendFile(path.join(__dirname, page + ".html"));
  });
});

// =====================================
// WAITING USER
// =====================================

let waitingUser = null;

// =====================================
// PARTNER MAP
// =====================================

const partners = new Map();

// =====================================
// SOCKET.IO CONNECTION
// =====================================

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  // ===================================
  // FIND RANDOM PARTNER
  // ===================================

  socket.on("find-partner", () => {

    console.log("Looking for partner:", socket.id);

    // Already connected to someone
    if (partners.has(socket.id)) {
      console.log("User already has partner:", socket.id);
      return;
    }

    // ---------------------------------
    // Find waiting user
    // ---------------------------------

    if (
      waitingUser &&
      waitingUser !== socket.id &&
      io.sockets.sockets.has(waitingUser)
    ) {

      const partner = waitingUser;

      // Remove waiting user
      waitingUser = null;

      // Save partners
      partners.set(socket.id, partner);
      partners.set(partner, socket.id);

      console.log("Matched:", partner, "<->", socket.id);

      // ---------------------------------
      // Tell NEW USER
      // ---------------------------------

      io.to(socket.id).emit("matched", {
        partnerId: partner,
        initiator: false
      });

      // ---------------------------------
      // Tell WAITING USER
      // ---------------------------------

      io.to(partner).emit("matched", {
        partnerId: socket.id,
        initiator: true
      });

    } else {

      // ---------------------------------
      // Put user in waiting queue
      // ---------------------------------

      waitingUser = socket.id;

      socket.emit("waiting");

      console.log("User waiting:", socket.id);
    }
  });

  // ===================================
  // WEBRTC SIGNALING
  // ===================================

  socket.on("signal", (data) => {

    if (!data) {
      console.log("Empty signal from:", socket.id);
      return;
    }

    const partnerId = partners.get(socket.id);

    if (!partnerId) {
      console.log(
        "No partner found for signal from:",
        socket.id
      );
      return;
    }

    console.log(
      "Signal:",
      data.type,
      socket.id,
      "->",
      partnerId
    );

    // Send signal to partner
    io.to(partnerId).emit("signal", {
      ...data,
      sender: socket.id
    });
  });

  // ===================================
  // TEXT CHAT
  // ===================================

  socket.on("chat-message", (data) => {

    if (!data) return;

    const partnerId = partners.get(socket.id);

    if (!partnerId) return;

    io.to(partnerId).emit("chat-message", {
      message: data.message,
      sender: socket.id
    });
  });

  // ===================================
  // REPORT USER
  // ===================================

  socket.on("report-user", (data) => {

    const partnerId = partners.get(socket.id);

    if (!partnerId) return;

    io.to(partnerId).emit("user-reported", {
      sender: socket.id,
      reason: data?.reason || "User reported"
    });
  });

  // ===================================
  // NEXT / SKIP
  // ===================================

  socket.on("next", () => {

    console.log("Next requested:", socket.id);

    // If waiting
    if (waitingUser === socket.id) {
      waitingUser = null;
    }

    const partnerId = partners.get(socket.id);

    // Remove current connection
    if (partnerId) {

      partners.delete(socket.id);
      partners.delete(partnerId);

      // Tell partner
      io.to(partnerId).emit("partner-disconnected", {
        partnerId: socket.id
      });
    }

    // Tell current user
    socket.emit("next-ready");

    console.log("Next completed:", socket.id);
  });

  // ===================================
  // STOP CHAT
  // ===================================

  socket.on("stop", () => {

    console.log("Stop requested:", socket.id);

    // Remove from waiting
    if (waitingUser === socket.id) {
      waitingUser = null;
    }

    const partnerId = partners.get(socket.id);

    if (partnerId) {

      partners.delete(socket.id);
      partners.delete(partnerId);

      io.to(partnerId).emit("partner-disconnected", {
        partnerId: socket.id
      });
    }

    console.log("Chat stopped:", socket.id);
  });

  // ===================================
  // DISCONNECT
  // ===================================

  socket.on("disconnect", () => {

    console.log("User disconnected:", socket.id);

    // Remove from waiting queue
    if (waitingUser === socket.id) {
      waitingUser = null;
    }

    // Find partner
    const partnerId = partners.get(socket.id);

    if (partnerId) {

      // Remove both
      partners.delete(socket.id);
      partners.delete(partnerId);

      // Notify partner
      io.to(partnerId).emit("partner-disconnected", {
        partnerId: socket.id
      });

      console.log(
        "Partner disconnected:",
        socket.id,
        "->",
        partnerId
      );
    }
  });

});

// =====================================
// START SERVER
// =====================================

server.listen(PORT, "0.0.0.0", () => {

  console.log("=====================================");
  console.log("QMEGLE SERVER STARTED");
  console.log("Port:", PORT);
  console.log("=====================================");

});
