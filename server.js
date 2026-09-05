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

/* =========================================
   EXPRESS
========================================= */

app.use(express.json());
app.use(express.static(__dirname));

/* =========================================
   MAIN PAGE
========================================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/health", (req, res) => {
  res.status(200).send("Qmegle server is running");
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
      path.join(__dirname, page + ".html")
    );
  });
});

/* =========================================
   USERS / MATCHING
========================================= */

const waitingQueue = [];

const partners = new Map();

const previousPartner = new Map();

const recentPairs = new Map();

const onlineUsers = new Set();

const nextUsers = new Set();

/*
  Same users ko immediately dobara match
  hone se rokne ke liye cooldown.
*/
const PAIR_COOLDOWN = 5 * 60 * 1000;

/*
  Next ke baad new stranger search delay.
*/
const NEXT_SEARCH_TIME = 2000;

/* =========================================
   PAIR KEY
========================================= */

function pairKey(a, b) {
  return [a, b]
    .sort()
    .join(":");
}

/* =========================================
   RECENT PAIR CHECK
========================================= */

function isRecentPair(a, b) {

  const key = pairKey(a, b);

  const time =
    recentPairs.get(key);

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
   REMOVE FROM QUEUE
========================================= */

function removeFromQueue(socketId) {

  let index;

  while (
    (index =
      waitingQueue.indexOf(socketId)) !== -1
  ) {

    waitingQueue.splice(
      index,
      1
    );

  }

}

/* =========================================
   ADD TO QUEUE
========================================= */

function addToQueue(socketId) {

  if (
    !onlineUsers.has(socketId)
  ) {
    return false;
  }

  if (
    partners.has(socketId)
  ) {
    return false;
  }

  if (
    waitingQueue.includes(socketId)
  ) {
    return false;
  }

  waitingQueue.push(socketId);

  console.log(
    "Added to waiting queue:",
    socketId
  );

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
      partners.has(id)
    ) {

      waitingQueue.splice(
        i,
        1
      );

    }

  }

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
    Recent pair aur previous partner
    ko avoid karo.
  */

  for (
    const candidate of waitingQueue
  ) {

    if (
      candidate === socketId
    ) {
      continue;
    }

    if (
      !onlineUsers.has(candidate)
    ) {
      continue;
    }

    if (
      partners.has(candidate)
    ) {
      continue;
    }

    if (
      candidate === oldPartner
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
    Fallback:
    Agar koi perfect stranger nahi mila
    to available user ko match karo.
  */

  for (
    const candidate of waitingQueue
  ) {

    if (
      candidate === socketId
    ) {
      continue;
    }

    if (
      !onlineUsers.has(candidate)
    ) {
      continue;
    }

    if (
      partners.has(candidate)
    ) {
      continue;
    }

    if (
      candidate === oldPartner
    ) {
      continue;
    }

    return candidate;

  }

  return null;
}

/* =========================================
   MATCH USERS
========================================= */

function matchUsers(
  userA,
  userB
) {

  if (
    userA === userB
  ) {
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

  nextUsers.delete(userA);
  nextUsers.delete(userB);

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

  /*
    User A
  */

  io.to(userA).emit(
    "matched",
    {
      partnerId: userB,
      initiator: true
    }
  );

  /*
    User B
  */

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

  if (
    !onlineUsers.has(socketId)
  ) {
    return false;
  }

  if (
    partners.has(socketId)
  ) {
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

  const count =
    onlineUsers.size;

  io.emit(
    "online-count",
    {
      online: count
    }
  );

  console.log(
    "Online users:",
    count
  );

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

    /*
      Add user to online list.
    */

    onlineUsers.add(
      socketId
    );

    /*
      Send current count to this user.
    */

    socket.emit(
      "online-count",
      {
        online:
          onlineUsers.size
      }
    );

    /*
      Broadcast updated count.
    */

    broadcastOnlineCount();


    /* =====================================
       FIND PARTNER
    ===================================== */

    socket.on(
      "find-partner",
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

      }
    );


    /* =====================================
       WEBRTC SIGNAL
    ===================================== */

    socket.on(
      "signal",
      (data) => {

        if (!data) {
          return;
        }

        const partnerId =
          partners.get(
            socketId
          );

        if (!partnerId) {
          return;
        }

        /*
          Only forward signal to
          current partner.
        */

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

        const partnerId =
          partners.get(
            socketId
          );

        if (!partnerId) {
          return;
        }

        if (!data) {
          return;
        }

        let message =
          String(
            data.message || ""
          ).trim();

        /*
          Maximum 2000 characters.
        */

        if (
          message.length > 2000
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

        const partnerId =
          partners.get(
            socketId
          );

        if (!partnerId) {
          return;
        }

        let reason =
          String(
            data?.reason || ""
          ).trim();

        if (
          reason.length > 1000
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
            reporter: socketId,
            reported: partnerId,
            reason
          }
        );

        /*
          Reporter ko confirmation.
        */

        io.to(
          socketId
        ).emit(
          "user-reported"
        );

      }
    );


    /* =====================================
       NEXT
    ===================================== */

    socket.on(
      "next",
      () => {

        const oldPartner =
          partners.get(
            socketId
          );

        /*
          Agar current partner hai
        */

        if (oldPartner) {

          /*
            Remove current pair.
          */

          partners.delete(
            socketId
          );

          partners.delete(
            oldPartner
          );

          nextUsers.add(
            socketId
          );

          nextUsers.add(
            oldPartner
          );

          /*
            Old partner ko notify.
          */

          io.to(
            oldPartner
          ).emit(
            "partner-left"
          );

          /*
            Dono ko queue se hatao.
          */

          removeFromQueue(
            socketId
          );

          removeFromQueue(
            oldPartner
          );

        }

        /*
          Current user ko immediately
          new search me bhejo.
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

            nextUsers.delete(
              socketId
            );

            tryMatch(
              socketId
            );

          },
          NEXT_SEARCH_TIME
        );


        /*
          Old partner ko bhi new
          stranger search karne do.
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

              nextUsers.delete(
                oldPartner
              );

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

        const partnerId =
          partners.get(
            socketId
          );

        /*
          Current user ka pair remove.
        */

        if (partnerId) {

          partners.delete(
            socketId
          );

          partners.delete(
            partnerId
          );

          /*
            Partner ko waiting state.
          */

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

        /*
          User ko queue se remove.
        */

        removeFromQueue(
          socketId
        );

        nextUsers.delete(
          socketId
        );

        /*
          User ko confirmation.
        */

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
      () => {

        console.log(
          "USER DISCONNECTED:",
          socketId
        );

        /*
          Online list se remove.
        */

        onlineUsers.delete(
          socketId
        );

        /*
          Queue se remove.
        */

        removeFromQueue(
          socketId
        );

        /*
          Next list se remove.
        */

        nextUsers.delete(
          socketId
        );


        /*
          Agar kisi partner ke saath
          connected tha.
        */

        const partnerId =
          partners.get(
            socketId
          );

        if (partnerId) {

          /*
            Pair remove.
          */

          partners.delete(
            socketId
          );

          partners.delete(
            partnerId
          );

          /*
            Partner ko notify.
          */

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
              Partner ko queue me
              daal do.
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
              1000
            );

          }

        }


        /*
          Previous partner cleanup.
        */

        previousPartner.delete(
          socketId
        );


        /*
          Online users update.
        */

        broadcastOnlineCount();

      }
    );

  }
);


/* =========================================
   CLEAN OLD RECENT PAIRS
========================================= */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        key,
        time
      ]
      of recentPairs.entries()
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
  60 * 1000
);


/* =========================================
   CLEAN WAITING QUEUE
========================================= */

setInterval(
  () => {

    cleanQueue();

  },
  10 * 1000
);


/* =========================================
   SERVER START
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
