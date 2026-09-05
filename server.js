const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// =====================================
// WEBSITE
// =====================================

app.use(express.static(__dirname));

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
// SMART MATCHING SYSTEM
// =====================================

// Waiting users
const waitingQueue = [];

// Current partner
const partners = new Map();

// Previous partner
const previousPartner = new Map();

// Recently used pairs
const recentPairs = new Map();

// Connected users
const onlineUsers = new Set();

// Users currently processing Next
const nextUsers = new Set();


// =====================================
// SETTINGS
// =====================================

// कितनी देर तक पुराने pair को avoid करना है
// 5 मिनट
const PAIR_COOLDOWN = 5 * 60 * 1000;

// Next के बाद नया stranger खोजने का समय
const NEXT_SEARCH_TIME = 2000;

// =====================================
// CREATE PAIR KEY
// =====================================

function pairKey(a, b) {
  return [a, b].sort().join(":");
}


// =====================================
// CHECK RECENT PAIR
// =====================================

function isRecentPair(a, b) {
  const key = pairKey(a, b);
  const time = recentPairs.get(key);

  if (!time) {
    return false;
  }

  if (Date.now() - time > PAIR_COOLDOWN) {
    recentPairs.delete(key);
    return false;
  }

  return true;
}


// =====================================
// REMEMBER PAIR
// =====================================

function rememberPair(a, b) {
  recentPairs.set(pairKey(a, b), Date.now());
}


// =====================================
// REMOVE USER FROM QUEUE
// =====================================

function removeFromQueue(socketId) {

  let index;

  while ((index = waitingQueue.indexOf(socketId)) !== -1) {
    waitingQueue.splice(index, 1);
  }
}


// =====================================
// ADD USER TO QUEUE
// =====================================

function addToQueue(socketId) {

  if (!onlineUsers.has(socketId)) {
    return false;
  }

  if (partners.has(socketId)) {
    return false;
  }

  if (waitingQueue.includes(socketId)) {
    return false;
  }

  waitingQueue.push(socketId);

  console.log("Added to waiting queue:", socketId);

  return true;
}


// =====================================
// CLEAN QUEUE
// =====================================

function cleanQueue() {

  for (let i = waitingQueue.length - 1; i >= 0; i--) {

    const id = waitingQueue[i];

    if (
      !onlineUsers.has(id) ||
      partners.has(id)
    ) {
      waitingQueue.splice(i, 1);
    }
  }
}


// =====================================
// FIND BEST STRANGER
// =====================================

function findBestStranger(socketId) {

  cleanQueue();

  const oldPartner = previousPartner.get(socketId);

  // -------------------------------------
  // First priority:
  // Completely new/recently unused stranger
  // -------------------------------------

  for (const candidate of waitingQueue) {

    if (candidate === socketId) {
      continue;
    }

    if (!onlineUsers.has(candidate)) {
      continue;
    }

    if (partners.has(candidate)) {
      continue;
    }

    // Don't immediately reconnect previous partner
    if (candidate === oldPartner) {
      continue;
    }

    // Avoid recently used pair
    if (isRecentPair(socketId, candidate)) {
      continue;
    }

    return candidate;
  }


  // -------------------------------------
  // Second priority:
  // Any stranger except previous partner
  // -------------------------------------

  for (const candidate of waitingQueue) {

    if (candidate === socketId) {
      continue;
    }

    if (!onlineUsers.has(candidate)) {
      continue;
    }

    if (partners.has(candidate)) {
      continue;
    }

    if (candidate === oldPartner) {
      continue;
    }

    return candidate;
  }


  return null;
}


// =====================================
// MATCH USERS
// =====================================

function matchUsers(userA, userB) {

  if (userA === userB) {
    return false;
  }

  if (!onlineUsers.has(userA)) {
    return false;
  }

  if (!onlineUsers.has(userB)) {
    return false;
  }

  if (partners.has(userA)) {
    return false;
  }

  if (partners.has(userB)) {
    return false;
  }

  removeFromQueue(userA);
  removeFromQueue(userB);

  nextUsers.delete(userA);
  nextUsers.delete(userB);

  partners.set(userA, userB);
  partners.set(userB, userA);

  previousPartner.set(userA, userB);
  previousPartner.set(userB, userA);

  rememberPair(userA, userB);

  console.log("-------------------------------------");
  console.log("NEW MATCH");
  console.log(userA);
  console.log("<->");
  console.log(userB);
  console.log("-------------------------------------");

  // A = WebRTC initiator
  io.to(userA).emit("matched", {
    partnerId: userB,
    initiator: true
  });

  // B = WebRTC receiver
  io.to(userB).emit("matched", {
    partnerId: userA,
    initiator: false
  });

  return true;
}


// =====================================
// TRY TO MATCH ONE USER
// =====================================

function tryMatch(socketId) {

  if (!onlineUsers.has(socketId)) {
    return false;
  }

  if (partners.has(socketId)) {
    return false;
  }

  removeFromQueue(socketId);

  const stranger = findBestStranger(socketId);

  if (stranger) {

    return matchUsers(socketId, stranger);
  }

  addToQueue(socketId);

  io.to(socketId).emit("waiting");

  return false;
}


// =====================================
// FALLBACK TO PREVIOUS PARTNER
// =====================================

function fallbackPreviousPartner(socketId) {

  if (!onlineUsers.has(socketId)) {
    return false;
  }

  if (partners.has(socketId)) {
    return false;
  }

  const oldPartner = previousPartner.get(socketId);

  if (!oldPartner) {
    return false;
  }

  if (!onlineUsers.has(oldPartner)) {
    return false;
  }

  if (partners.has(oldPartner)) {
    return false;
  }

  // Check if a NEW stranger is available
  const stranger = findBestStranger(socketId);

  if (stranger) {
    return matchUsers(socketId, stranger);
  }

  // Only previous partner is available
  removeFromQueue(socketId);
  removeFromQueue(oldPartner);

  console.log("-------------------------------------");
  console.log("ONLY TWO USERS AVAILABLE");
  console.log("Reconnecting previous pair");
  console.log(socketId, "<->", oldPartner);
  console.log("-------------------------------------");

  return matchUsers(socketId, oldPartner);
}


// =====================================
// CONNECTION
// =====================================

io.on("connection", (socket) => {

  const socketId = socket.id;

  onlineUsers.add(socketId);

  console.log("-------------------------------------");
  console.log("USER CONNECTED");
  console.log(socketId);
  console.log("ONLINE:", onlineUsers.size);
  console.log("-------------------------------------");


  // ===================================
  // FIND PARTNER
  // ===================================

  socket.on("find-partner", () => {

    console.log("Find partner:", socketId);

    if (!onlineUsers.has(socketId)) {
      return;
    }

    if (partners.has(socketId)) {
      return;
    }

    nextUsers.delete(socketId);

    removeFromQueue(socketId);

    tryMatch(socketId);
  });


  // ===================================
  // WEBRTC SIGNALING
  // ===================================

  socket.on("signal", (data) => {

    if (!data) {
      return;
    }

    const partnerId = partners.get(socketId);

    if (!partnerId) {
      console.log("Signal ignored: no partner");
      return;
    }

    if (!onlineUsers.has(partnerId)) {
      return;
    }

    io.to(partnerId).emit("signal", {
      ...data,
      sender: socketId
    });

  });


  // ===================================
  // CHAT MESSAGE
  // ===================================

  socket.on("chat-message", (data) => {

    if (!data) {
      return;
    }

    const partnerId = partners.get(socketId);

    if (!partnerId) {
      return;
    }

    io.to(partnerId).emit("chat-message", {
      message: data.message,
      sender: socketId
    });

  });


  // ===================================
  // REPORT USER
  // ===================================

  socket.on("report-user", (data) => {

    const partnerId = partners.get(socketId);

    if (!partnerId) {
      return;
    }

    io.to(partnerId).emit("user-reported", {
      sender: socketId,
      reason: data?.reason || "User reported"
    });

  });


  // ===================================
  // NEXT
  // ===================================

  socket.on("next", () => {

    console.log("-------------------------------------");
    console.log("NEXT REQUEST");
    console.log(socketId);
    console.log("-------------------------------------");

    // Prevent double Next
    if (nextUsers.has(socketId)) {
      console.log("Duplicate Next ignored:", socketId);
      return;
    }

    nextUsers.add(socketId);

    removeFromQueue(socketId);

    const partnerId = partners.get(socketId);

    // =================================
    // CASE 1:
    // User has no partner
    // =================================

    if (!partnerId) {

      io.to(socketId).emit("next-ready");

      setTimeout(() => {

        if (!onlineUsers.has(socketId)) {
          return;
        }

        if (partners.has(socketId)) {
          return;
        }

        nextUsers.delete(socketId);

        tryMatch(socketId);

      }, 300);

      return;
    }


    // =================================
    // CASE 2:
    // User has partner
    // =================================

    partners.delete(socketId);
    partners.delete(partnerId);

    rememberPair(socketId, partnerId);

    previousPartner.set(socketId, partnerId);
    previousPartner.set(partnerId, socketId);

    // Tell both users that current chat ended
    if (onlineUsers.has(partnerId)) {

      io.to(partnerId).emit("partner-disconnected", {
        partnerId: socketId
      });

    }


    // Both users become available
    if (onlineUsers.has(socketId)) {
      addToQueue(socketId);
    }

    if (onlineUsers.has(partnerId)) {
      addToQueue(partnerId);
    }


    // Tell clients Next is ready
    io.to(socketId).emit("next-ready");

    if (onlineUsers.has(partnerId)) {
      io.to(partnerId).emit("next-ready");
    }


    // =================================
    // SEARCH FOR NEW STRANGERS
    // =================================

    setTimeout(() => {

      if (!onlineUsers.has(socketId)) {
        return;
      }

      if (!onlineUsers.has(partnerId)) {
        return;
      }

      if (partners.has(socketId)) {
        return;
      }

      if (partners.has(partnerId)) {
        return;
      }


      // --------------------------------
      // First try new stranger for A
      // --------------------------------

      const strangerA = findBestStranger(socketId);

      if (
        strangerA &&
        strangerA !== partnerId
      ) {

        nextUsers.delete(socketId);

        matchUsers(
          socketId,
          strangerA
        );

        return;
      }


      // --------------------------------
      // Then try new stranger for B
      // --------------------------------

      const strangerB = findBestStranger(partnerId);

      if (
        strangerB &&
        strangerB !== socketId
      ) {

        nextUsers.delete(partnerId);

        matchUsers(
          partnerId,
          strangerB
        );

        return;
      }


      // =================================
      // ONLY TWO USERS ONLINE
      // =================================

      const activeUsers = Array.from(onlineUsers);

      const availableUsers = activeUsers.filter((id) => {
        return !partners.has(id);
      });


      if (
        availableUsers.length === 2 &&
        availableUsers.includes(socketId) &&
        availableUsers.includes(partnerId)
      ) {

        console.log("-------------------------------------");
        console.log("ONLY TWO USERS ONLINE");
        console.log("FALLBACK REMATCH");
        console.log("-------------------------------------");

        nextUsers.delete(socketId);
        nextUsers.delete(partnerId);

        removeFromQueue(socketId);
        removeFromQueue(partnerId);

        matchUsers(
          socketId,
          partnerId
        );

        return;
      }


      // =================================
      // GENERAL FALLBACK
      // =================================

      nextUsers.delete(socketId);
      nextUsers.delete(partnerId);

      tryMatch(socketId);
      tryMatch(partnerId);

    }, NEXT_SEARCH_TIME);

  });


  // ===================================
  // STOP
  // ===================================

  socket.on("stop", () => {

    console.log("STOP:", socketId);

    nextUsers.delete(socketId);

    removeFromQueue(socketId);

    const partnerId = partners.get(socketId);

    if (!partnerId) {
      return;
    }

    partners.delete(socketId);
    partners.delete(partnerId);

    rememberPair(socketId, partnerId);

    previousPartner.set(socketId, partnerId);
    previousPartner.set(partnerId, socketId);

    if (onlineUsers.has(partnerId)) {

      io.to(partnerId).emit(
        "partner-disconnected",
        {
          partnerId: socketId
        }
      );

      // Partner becomes available
      addToQueue(partnerId);

      io.to(partnerId).emit("waiting");

    }

  });


  // ===================================
  // DISCONNECT
  // ===================================

  socket.on("disconnect", () => {

    console.log("-------------------------------------");
    console.log("USER DISCONNECTED");
    console.log(socketId);
    console.log("-------------------------------------");

    onlineUsers.delete(socketId);

    nextUsers.delete(socketId);

    removeFromQueue(socketId);

    const partnerId = partners.get(socketId);

    if (partnerId) {

      partners.delete(socketId);
      partners.delete(partnerId);

      previousPartner.set(
        partnerId,
        socketId
      );

      rememberPair(
        socketId,
        partnerId
      );

      // Tell remaining user
      if (onlineUsers.has(partnerId)) {

        io.to(partnerId).emit(
          "partner-disconnected",
          {
            partnerId: socketId
          }
        );

        // Remaining user becomes available
        addToQueue(partnerId);

        io.to(partnerId).emit("waiting");

      }

    }

    console.log(
      "ONLINE USERS:",
      onlineUsers.size
    );

  });

});


// =====================================
// CLEAN OLD PAIR HISTORY
// =====================================

setInterval(() => {

  const now = Date.now();

  for (const [key, time] of recentPairs.entries()) {

    if (now - time > PAIR_COOLDOWN) {
      recentPairs.delete(key);
    }

  }

}, 60 * 1000);


// =====================================
// SERVER START
// =====================================

server.listen(PORT, "0.0.0.0", () => {

  console.log("=====================================");
  console.log("       QMEGLE SERVER STARTED");
  console.log("=====================================");
  console.log("Port:", PORT);
  console.log("Smart Matching: ON");
  console.log("Pair History: ON");
  console.log("Queue Protection: ON");
  console.log("Next Protection: ON");
  console.log("=====================================");

});
