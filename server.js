const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

/* =========================================
   SOCKET.IO
========================================= */

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },

  transports: ["websocket", "polling"],

  pingInterval: 25000,
  pingTimeout: 20000,

  maxHttpBufferSize: 1e6
});

const PORT = process.env.PORT || 3000;

/* =========================================
   EXPRESS
========================================= */

app.disable("x-powered-by");

app.use(
  express.json({
    limit: "100kb"
  })
);

app.use(express.static(__dirname));

/* =========================================
   MATCHING DATA
========================================= */

const waitingQueue = [];
const waitingSet = new Set();

const partners = new Map();
const previousPartner = new Map();
const recentPairs = new Map();

const onlineUsers = new Set();

/* =========================================
   SETTINGS
========================================= */

const PAIR_COOLDOWN = 5 * 60 * 1000;

const NEXT_SEARCH_TIME = 2000;

const DISCONNECT_SEARCH_TIME = 1000;

const QUEUE_CLEAN_INTERVAL = 10000;

const RECENT_PAIR_CLEAN_INTERVAL = 60000;

/* =========================================
   RATE LIMIT SETTINGS
========================================= */

const RATE_LIMITS = {
  "find-partner": {
    max: 10,
    window: 10000
  },

  next: {
    max: 10,
    window: 10000
  },

  stop: {
    max: 10,
    window: 10000
  },

  "chat-message": {
    max: 20,
    window: 10000
  },

  "report-user": {
    max: 5,
    window: 60000
  },

  signal: {
    max: 250,
    window: 10000
  }
};

const socketRateLimits = new Map();

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
    path.join(
      __dirname,
      "articles",
      "index.html"
    )
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
    path.join(
      __dirname,
      "community-guidelines.html"
    )
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
   HEALTH CHECK
========================================= */

app.get("/health", (req, res) => {
  res.status(200).send(
    "Qmegle server is running"
  );
});

/* =========================================
   ONLINE USERS API
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
      path.join(
        __dirname,
        page + ".html"
      )
    );

  });

});

/* =========================================
   PAIR KEY
========================================= */

function pairKey(a, b) {

  return [a, b]
    .sort()
    .join(":");

}

/* =========================================
   CHECK RECENT PAIR
========================================= */

function isRecentPair(a, b) {

  const key = pairKey(a, b);

  const time = recentPairs.get(key);

  if (!time) {
    return false;
  }

  if (
    Date.now() - time >
    PAIR_COOLDOWN
  ) {

    recentPairs.delete(key);

    return false;
  }

  return true;
}

/* =========================================
   REMEMBER PAIR
========================================= */

function rememberPair(a, b) {

  recentPairs.set(
    pairKey(a, b),
    Date.now()
  );

}

/* =========================================
   REMOVE USER FROM QUEUE
========================================= */

function removeFromQueue(socketId) {

  if (!waitingSet.has(socketId)) {
    return;
  }

  waitingSet.delete(socketId);

  const index =
    waitingQueue.indexOf(socketId);

  if (index !== -1) {

    waitingQueue.splice(
      index,
      1
    );

  }

}

/* =========================================
   ADD USER TO QUEUE
========================================= */

function addToQueue(socketId) {

  if (!onlineUsers.has(socketId)) {
    return false;
  }

  if (partners.has(socketId)) {
    return false;
  }

  if (waitingSet.has(socketId)) {
    return false;
  }

  waitingQueue.push(socketId);

  waitingSet.add(socketId);

  return true;
}

/* =========================================
   CLEAN QUEUE
========================================= */

function cleanQueue() {

  for (
    let i = waitingQueue.length - 1;
    i >= 0;
    i--
  ) {

    const id =
      waitingQueue[i];

    if (
      !onlineUsers.has(id) ||
      partners.has(id) ||
      !waitingSet.has(id)
    ) {

      waitingQueue.splice(
        i,
        1
      );

      waitingSet.delete(id);
    }

  }

}

/* =========================================
   CHECK AVAILABLE CANDIDATE
========================================= */

function isAvailableCandidate(
  candidate,
  socketId,
  oldPartner
) {

  if (candidate === socketId) {
    return false;
  }

  if (!onlineUsers.has(candidate)) {
    return false;
  }

  if (partners.has(candidate)) {
    return false;
  }

  if (candidate === oldPartner) {
    return false;
  }

  return true;
}

/* =========================================
   FIND BEST STRANGER
========================================= */

function findBestStranger(socketId) {

  cleanQueue();

  const oldPartner =
    previousPartner.get(socketId);

  /*
     First try:
     Do not immediately match
     the same recent person.
  */

  for (
    const candidate of waitingQueue
  ) {

    if (
      !isAvailableCandidate(
        candidate,
        socketId,
        oldPartner
      )
    ) {
      continue;
    }

    if (
      !isRecentPair(
        socketId,
        candidate
      )
    ) {

      return candidate;
    }

  }

  /*
     Second try:
     If nobody else is available,
     match anyway instead of
     making the user wait forever.
  */

  for (
    const candidate of waitingQueue
  ) {

    if (
      !isAvailableCandidate(
        candidate,
        socketId,
        oldPartner
      )
    ) {
      continue;
    }

    return candidate;
  }

  return null;
}

/* =========================================
   MATCH TWO USERS
========================================= */

function matchUsers(
  userA,
  userB
) {

  if (userA === userB) {
    return false;
  }

  if (
    !onlineUsers.has(userA) ||
    !onlineUsers.has(userB)
  ) {

    return false;
  }

  if (
    partners.has(userA) ||
    partners.has(userB)
  ) {

    return false;
  }

  removeFromQueue(userA);
  removeFromQueue(userB);

  partners.set(
    userA,
    userB
  );

  partners.set(
    userB,
    userA
  );

  previousPartner.set(
    userA,
    userB
  );

  previousPartner.set(
    userB,
    userA
  );

  rememberPair(
    userA,
    userB
  );

  io.to(userA).emit(
    "matched",
    {
      partnerId: userB,
      initiator: true
    }
  );

  io.to(userB).emit(
    "matched",
    {
      partnerId: userA,
      initiator: false
    }
  );

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

  io.to(socketId).emit(
    "waiting"
  );

  return false;
}

/* =========================================
   ONLINE COUNT
========================================= */

function broadcastOnlineCount() {

  io.emit(
    "online-count",
    {
      online:
        onlineUsers.size
    }
  );

  console.log(
    "Online users:",
    onlineUsers.size
  );
}

/* =========================================
   RATE LIMIT FUNCTION
========================================= */

function allowedByRateLimit(
  socketId,
  eventName
) {

  const config =
    RATE_LIMITS[eventName];

  if (!config) {
    return true;
  }

  let limits =
    socketRateLimits.get(
      socketId
    );

  if (!limits) {

    limits = new Map();

    socketRateLimits.set(
      socketId,
      limits
    );

  }

  const now =
    Date.now();

  let record =
    limits.get(eventName);

  if (
    !record ||
    now - record.start >=
      config.window
  ) {

    record = {
      start: now,
      count: 0
    };

    limits.set(
      eventName,
      record
    );

  }

  record.count++;

  if (
    record.count >
    config.max
  ) {

    return false;
  }

  return true;
}

/* =========================================
   SOCKET CONNECTION
========================================= */

io.on(
  "connection",
  (socket) => {

    const socketId =
      socket.id;

    console.log(
      "USER CONNECTED:",
      socketId
    );

    onlineUsers.add(
      socketId
    );

    socketRateLimits.set(
      socketId,
      new Map()
    );

    socket.emit(
      "online-count",
      {
        online:
          onlineUsers.size
      }
    );

    broadcastOnlineCount();

    /* =====================================
       FIND PARTNER
    ===================================== */

    socket.on(
      "find-partner",
      () => {

        if (
          !allowedByRateLimit(
            socketId,
            "find-partner"
          )
        ) {
          return;
        }

        if (
          !onlineUsers.has(
            socketId
          )
        ) {
          return;
        }

        if (
          partners.has(
            socketId
          )
        ) {
          return;
        }

        tryMatch(
          socketId
        );

      }
    );

    /* =====================================
       WEBRTC SIGNAL
    ===================================== */

    socket.on(
      "signal",
      (data) => {

        if (
          !allowedByRateLimit(
            socketId,
            "signal"
          )
        ) {
          return;
        }

        if (
          !data ||
          typeof data !==
            "object"
        ) {
          return;
        }

        const partnerId =
          partners.get(
            socketId
          );

        if (!partnerId) {
          return;
        }

        if (
          !onlineUsers.has(
            partnerId
          )
        ) {
          return;
        }

        io.to(
          partnerId
        ).emit(
          "signal",
          data
        );

      }
    );

    /* =====================================
       CHAT MESSAGE
    ===================================== */

    socket.on(
      "chat-message",
      (data) => {

        if (
          !allowedByRateLimit(
            socketId,
            "chat-message"
          )
        ) {
          return;
        }

        const partnerId =
          partners.get(
            socketId
          );

        if (
          !partnerId ||
          !onlineUsers.has(
            partnerId
          )
        ) {
          return;
        }

        if (
          !data ||
          typeof data !==
            "object"
        ) {
          return;
        }

        let message =
          String(
            data.message || ""
          ).trim();

        if (
          message.length >
          2000
        ) {

          message =
            message.substring(
              0,
              2000
            );

        }

        if (!message) {
          return;
        }

        io.to(
          partnerId
        ).emit(
          "chat-message",
          {
            message
          }
        );

      }
    );

    /* =====================================
       REPORT USER
    ===================================== */

    socket.on(
      "report-user",
      (data) => {

        if (
          !allowedByRateLimit(
            socketId,
            "report-user"
          )
        ) {
          return;
        }

        const partnerId =
          partners.get(
            socketId
          );

        if (!partnerId) {
          return;
        }

        let reason =
          String(
            data &&
            data.reason
              ? data.reason
              : ""
          ).trim();

        if (
          reason.length >
          1000
        ) {

          reason =
            reason.substring(
              0,
              1000
            );

        }

        console.log(
          "USER REPORT:",
          {
            reporter:
              socketId,

            reported:
              partnerId,

            reason
          }
        );

        socket.emit(
          "user-reported"
        );

      }
    );

    /* =====================================
       NEXT USER
    ===================================== */

    socket.on(
      "next",
      () => {

        if (
          !allowedByRateLimit(
            socketId,
            "next"
          )
        ) {
          return;
        }

        if (
          !onlineUsers.has(
            socketId
          )
        ) {
          return;
        }

        const oldPartner =
          partners.get(
            socketId
          );

        if (oldPartner) {

          partners.delete(
            socketId
          );

          partners.delete(
            oldPartner
          );

          removeFromQueue(
            socketId
          );

          removeFromQueue(
            oldPartner
          );

          if (
            onlineUsers.has(
              oldPartner
            )
          ) {

            io.to(
              oldPartner
            ).emit(
              "partner-left"
            );

          }

        }

        /*
           Search for new partner
           after 2 seconds.
        */

        setTimeout(
          () => {

            if (
              !onlineUsers.has(
                socketId
              )
            ) {
              return;
            }

            if (
              partners.has(
                socketId
              )
            ) {
              return;
            }

            tryMatch(
              socketId
            );

          },
          NEXT_SEARCH_TIME
        );

        /*
           Also search for the
           previous partner.
        */

        if (oldPartner) {

          setTimeout(
            () => {

              if (
                !onlineUsers.has(
                  oldPartner
                )
              ) {
                return;
              }

              if (
                partners.has(
                  oldPartner
                )
              ) {
                return;
              }

              tryMatch(
                oldPartner
              );

            },
            NEXT_SEARCH_TIME
          );

        }

      }
    );

    /* =====================================
       STOP
    ===================================== */

    socket.on(
      "stop",
      () => {

        if (
          !allowedByRateLimit(
            socketId,
            "stop"
          )
        ) {
          return;
        }

        if (
          !onlineUsers.has(
            socketId
          )
        ) {
          return;
        }

        const partnerId =
          partners.get(
            socketId
          );

        if (partnerId) {

          partners.delete(
            socketId
          );

          partners.delete(
            partnerId
          );

          removeFromQueue(
            socketId
          );

          removeFromQueue(
            partnerId
          );

          if (
            onlineUsers.has(
              partnerId
            )
          ) {

            io.to(
              partnerId
            ).emit(
              "partner-left"
            );

          }

        }

        removeFromQueue(
          socketId
        );

        socket.emit(
          "stopped"
        );

      }
    );

    /* =====================================
       DISCONNECT
    ===================================== */

    socket.on(
      "disconnect",
      (reason) => {

        console.log(
          "USER DISCONNECTED:",
          socketId,
          reason || ""
        );

        onlineUsers.delete(
          socketId
        );

        removeFromQueue(
          socketId
        );

        const partnerId =
          partners.get(
            socketId
          );

        if (partnerId) {

          partners.delete(
            socketId
          );

          partners.delete(
            partnerId
          );

          if (
            onlineUsers.has(
              partnerId
            )
          ) {

            io.to(
              partnerId
            ).emit(
              "partner-left"
            );

            /*
               Give remaining user
               a new stranger.
            */

            setTimeout(
              () => {

                if (
                  onlineUsers.has(
                    partnerId
                  ) &&
                  !partners.has(
                    partnerId
                  )
                ) {

                  tryMatch(
                    partnerId
                  );

                }

              },
              DISCONNECT_SEARCH_TIME
            );

          }

        }

        previousPartner.delete(
          socketId
        );

        socketRateLimits.delete(
          socketId
        );

        broadcastOnlineCount();

      }
    );

  }
);

/* =========================================
   CLEAN RECENT PAIRS
========================================= */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        key,
        time
      ] of recentPairs.entries()
    ) {

      if (
        now - time >
        PAIR_COOLDOWN
      ) {

        recentPairs.delete(
          key
        );

      }

    }

  },
  RECENT_PAIR_CLEAN_INTERVAL
);

/* =========================================
   CLEAN QUEUE
========================================= */

setInterval(
  () => {

    cleanQueue();

  },
  QUEUE_CLEAN_INTERVAL
);

/* =========================================
   CLEAN RATE LIMIT MEMORY
========================================= */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        socketId,
        limits
      ] of socketRateLimits.entries()
    ) {

      if (
        !onlineUsers.has(
          socketId
        )
      ) {

        socketRateLimits.delete(
          socketId
        );

        continue;
      }

      for (
        const [
          eventName,
          record
        ] of limits.entries()
      ) {

        const config =
          RATE_LIMITS[eventName];

        if (
          !config ||
          now - record.start >=
            config.window * 2
        ) {

          limits.delete(
            eventName
          );

        }

      }

    }

  },
  60000
);

/* =========================================
   GRACEFUL SHUTDOWN
========================================= */

function shutdown(signal) {

  console.log(
    signal +
    " received. Shutting down Qmegle..."
  );

  io.close(
    () => {

      server.close(
        () => {

          console.log(
            "Qmegle server stopped."
          );

          process.exit(0);

        }
      );

    }
  );

  setTimeout(
    () => {

      process.exit(1);

    },
    10000
  ).unref();

}

process.on(
  "SIGTERM",
  () => {
    shutdown("SIGTERM");
  }
);

process.on(
  "SIGINT",
  () => {
    shutdown("SIGINT");
  }
);

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
