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

// =====================================
// PORT - RENDER + LOCAL
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

// SEO pages
const seoPages = [
"random-video-chat",
"free-video-chat",
"chat-with-strangers",
"random-text-chat",
"omegle-alternative"
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
// SOCKET.IO
// =====================================

io.on("connection", (socket) => {
console.log("User connected:", socket.id);

// -----------------------------------
// FIND RANDOM CHAT PARTNER
// -----------------------------------

socket.on("find-partner", () => {
console.log("Looking for partner:", socket.id);

```
// If another user is waiting
if (waitingUser && waitingUser !== socket.id) {
  const partner = waitingUser;

  waitingUser = null;

  // Put both users in the same room
  const room = `${partner}-${socket.id}`;

  socket.join(room);
  io.sockets.sockets.get(partner)?.join(room);

  // Tell both users they are matched
  io.to(socket.id).emit("matched", {
    partnerId: partner,
    room: room,
    initiator: false
  });

  io.to(partner).emit("matched", {
    partnerId: socket.id,
    room: room,
    initiator: true
  });

  console.log("Matched:", partner, "<->", socket.id);
} else {
  // No user available
  waitingUser = socket.id;

  socket.emit("waiting");

  console.log("User waiting:", socket.id);
}
```

});

// -----------------------------------
// WEBRTC SIGNALING
// -----------------------------------

socket.on("offer", (data) => {
if (!data || !data.target) return;

```
io.to(data.target).emit("offer", {
  offer: data.offer,
  sender: socket.id
});
```

});

socket.on("answer", (data) => {
if (!data || !data.target) return;

```
io.to(data.target).emit("answer", {
  answer: data.answer,
  sender: socket.id
});
```

});

socket.on("ice-candidate", (data) => {
if (!data || !data.target) return;

```
io.to(data.target).emit("ice-candidate", {
  candidate: data.candidate,
  sender: socket.id
});
```

});

// -----------------------------------
// TEXT CHAT
// -----------------------------------

socket.on("chat-message", (data) => {
if (!data || !data.target) return;

```
io.to(data.target).emit("chat-message", {
  message: data.message,
  sender: socket.id
});
```

});

// -----------------------------------
// NEXT / SKIP PARTNER
// -----------------------------------

socket.on("next", () => {
console.log("Next requested:", socket.id);

```
if (waitingUser === socket.id) {
  waitingUser = null;
}

socket.emit("next-ready");
```

});

// -----------------------------------
// DISCONNECT
// -----------------------------------

socket.on("disconnect", () => {
console.log("User disconnected:", socket.id);

```
if (waitingUser === socket.id) {
  waitingUser = null;
}

// Notify any connected users who may be talking
socket.broadcast.emit("partner-disconnected", {
  partnerId: socket.id
});
```

});
});

// =====================================
// START SERVER
// =====================================

server.listen(PORT, "0.0.0.0", () => {
console.log("=====================================");
console.log("Qmegle Server Started");
console.log("Port:", PORT);
console.log("=====================================");
});
