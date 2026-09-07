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

app.use(express.json());
app.use(express.static(__dirname));

const waitingQueue = [];
const partners = new Map();
const previousPartner = new Map();
const recentPairs = new Map();
const onlineUsers = new Set();

const PAIR_COOLDOWN = 5 * 60 * 1000;
const NEXT_SEARCH_TIME = 2000;


/* =========================================
   MAIN PAGE
========================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});


/* =========================================
   ARTICLES
========================================= */

app.get("/articles", (req, res) => {
  res.sendFile(
    path.join(__dirname, "articles", "index.html")
  );
});


/* =========================================
   INFORMATION PAGES
========================================= */

app.get("/about", (req, res) => {
  res.sendFile(
    path.join(__dirname, "about.html")
  );
});

app.get("/contact", (req, res) => {
  res.sendFile(
    path.join(__dirname, "contact.html")
  );
});

app.get("/privacy", (req, res) => {
  res.sendFile(
    path.join(__dirname, "privacy.html")
  );
});

app.get("/terms", (req, res) => {
  res.sendFile(
    path.join(__dirname, "terms.html")
  );
});

app.get("/community-guidelines", (req, res) => {
  res.sendFile(
    path.join(__dirname, "community-guidelines.html")
  );
});


/* =========================================
   SITEMAP
========================================= */

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml");

  res.sendFile(
    path.join(__dirname, "sitemap.xml")
  );
});


/* =========================================
   HEALTH
========================================= */

app.get("/health", (req, res) => {
  res.status(200).send("Qmegle server is running");
});


/* =========================================
   ONLINE USERS
========================================= */

app.get("/api/online", (req, res) => {
  res.json({
    online: onlineUsers.size
  });
});


/* =========================================
   SEO PAGES
========================================= */

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
    res.sendFile(
      path.join(__dirname, page + ".html")
    );
  });
});


/* =========================================
   PAIR KEY
========================================= */

function pairKey(a, b) {
  return [a, b].sort().join(":");
}


/* =========================================
   RECENT PAIR
========================================= */

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


function rememberPair(a, b) {
  recentPairs.set(
    pairKey(a, b),
    Date.now()
  );
}


/* =========================================
   QUEUE
========================================= */

function removeFromQueue(socketId) {
  let index = waitingQueue.indexOf(socketId);

  while (index !== -1) {
    waitingQueue.splice(index, 1);
    index = waitingQueue.indexOf(socketId);
  }
}


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

  return true;
}


function cleanQueue() {
  for (
    let i = waitingQueue.length - 1;
    i >= 0;
    i--
  ) {
    const id = waitingQueue[i];

    if (
      !onlineUsers.has(id) ||
      partners.has(id)
    ) {
      waitingQueue.splice(i, 1);
    }
  }
}


/* =========================================
   FIND PARTNER
========================================= */

function findBestStranger(socketId) {
  cleanQueue();

  const oldPartner =
    previousPartner.get(socketId);

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

    if (!isRecentPair(socketId, candidate)) {
      return candidate;
    }
  }

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


/* =========================================
   MATCH
========================================= */

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

  partners.set(userA, userB);
  partners.set(userB, userA);

  previousPartner.set(userA, userB);
  previousPartner.set(userB, userA);

  rememberPair(userA, userB);

  io.to(userA).emit("matched", {
    partnerId: userB,
    initiator: true
  });

  io.to(userB).emit("matched", {
    partnerId: userA,
    initiator: false
  });

  console.log(
    "MATCHED:",
    userA,
    "<->",
    userB
  );

  return true;
}


/* =========================================
   TRY MATCH
========================================= */

function tryMatch(socketId) {
  if (!onlineUsers.has(socketId)) {
    return false;
  }

  if (partners.has(socketId)) {
    return false;
  }

  removeFromQueue(socketId);

  const stranger =
    findBestStranger(socketId);

  if (stranger) {
    return matchUsers(
      socketId,
      stranger
    );
  }

  addToQueue(socketId);

  io.to(socketId).emit("waiting");

  return false;
}


/* =========================================
   ONLINE COUNT
========================================= */

function broadcastOnlineCount() {
  io.emit("online-count", {
    online: onlineUsers.size
  });

  console.log(
    "Online users:",
    onlineUsers.size
  );
}


/* =========================================
   SOCKET
========================================= */

io.on("connection", (socket) => {
  const socketId = socket.id;

  console.log(
    "USER CONNECTED:",
    socketId
  );

  onlineUsers.add(socketId);

  socket.emit("online-count", {
    online: onlineUsers.size
  });

  broadcastOnlineCount();


  /* =========================================
     FIND PARTNER
  ========================================= */

  socket.on("find-partner", () => {
    if (!onlineUsers.has(socketId)) {
      return;
    }

    if (partners.has(socketId)) {
      return;
    }

    tryMatch(socketId);
  });


  /* =========================================
     SIGNAL
  ========================================= */

  socket.on("signal", (data) => {
    if (!data) {
      return;
    }

    const partnerId =
      partners.get(socketId);

    if (!partnerId) {
      return;
    }

    io.to(partnerId).emit(
      "signal",
      data
    );
  });


  /* =========================================
     CHAT
  ========================================= */

  socket.on("chat-message", (data) => {
    const partnerId =
      partners.get(socketId);

    if (!partnerId) {
      return;
    }

    if (!data) {
      return;
    }

    let message =
      String(data.message || "").trim();

    if (message.length > 2000) {
      message =
        message.substring(0, 2000);
    }

    if (!message) {
      return;
    }

    io.to(partnerId).emit(
      "chat-message",
      {
        message: message
      }
    );
  });


  /* =========================================
     REPORT
  ========================================= */

  socket.on("report-user", (data) => {
    const partnerId =
      partners.get(socketId);

    if (!partnerId) {
      return;
    }

    let reason =
      String(
        data && data.reason
          ? data.reason
          : ""
      ).trim();

    if (reason.length > 1000) {
      reason =
        reason.substring(0, 1000);
    }

    console.log(
      "USER REPORT:",
      {
        reporter: socketId,
        reported: partnerId,
        reason: reason
      }
    );

    io.to(socketId).emit(
      "user-reported"
    );
  });


  /* =========================================
     NEXT
  ========================================= */

  socket.on("next", () => {
    const oldPartner =
      partners.get(socketId);

    if (oldPartner) {
      partners.delete(socketId);
      partners.delete(oldPartner);

      io.to(oldPartner).emit(
        "partner-left"
      );

      removeFromQueue(socketId);
      removeFromQueue(oldPartner);
    }

    setTimeout(() => {
      if (!onlineUsers.has(socketId)) {
        return;
      }

      if (partners.has(socketId)) {
        return;
      }

      tryMatch(socketId);
    }, NEXT_SEARCH_TIME);

    if (oldPartner) {
      setTimeout(() => {
        if (!onlineUsers.has(oldPartner)) {
          return;
        }

        if (partners.has(oldPartner)) {
          return;
        }

        tryMatch(oldPartner);
      }, NEXT_SEARCH_TIME);
    }
  });


  /* =========================================
     STOP
  ========================================= */

  socket.on("stop", () => {
    const partnerId =
      partners.get(socketId);

    if (partnerId) {
      partners.delete(socketId);
      partners.delete(partnerId);

      if (onlineUsers.has(partnerId)) {
        io.to(partnerId).emit(
          "partner-left"
        );
      }
    }

    removeFromQueue(socketId);

    socket.emit("stopped");
  });


  /* =========================================
     DISCONNECT
  ========================================= */

  socket.on("disconnect", () => {
    console.log(
      "USER DISCONNECTED:",
      socketId
    );

    onlineUsers.delete(socketId);

    removeFromQueue(socketId);

    const partnerId =
      partners.get(socketId);

    if (partnerId) {
      partners.delete(socketId);
      partners.delete(partnerId);

      if (onlineUsers.has(partnerId)) {
        io.to(partnerId).emit(
          "partner-left"
        );

        setTimeout(() => {
          if (
            onlineUsers.has(partnerId) &&
            !partners.has(partnerId)
          ) {
            tryMatch(partnerId);
          }
        }, 1000);
      }
    }

    previousPartner.delete(socketId);

    broadcastOnlineCount();
  });
});


/* =========================================
   CLEAN RECENT PAIRS
========================================= */

setInterval(() => {
  const now = Date.now();

  for (
    const [key, time]
    of recentPairs.entries()
  ) {
    if (
      now - time >
      PAIR_COOLDOWN
    ) {
      recentPairs.delete(key);
    }
  }
}, 60000);


/* =========================================
   CLEAN QUEUE
========================================= */

setInterval(() => {
  cleanQueue();
}, 10000);


/* =========================================
   START SERVER
========================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "===================================="
    );

    console.log(
      "       QMEGLE SERVER STARTED"
    );

    console.log(
      "===================================="
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Online users:",
      onlineUsers.size
    );
  }
);
