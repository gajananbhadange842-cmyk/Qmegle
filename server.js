```javascript
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
// WEBSITE
// =====================================

app.use(express.static(__dirname));


// =====================================
// WAITING USER
// =====================================

let waitingUser = null;


// =====================================
// FIND PARTNER FUNCTION
// =====================================

function findPartner(socket) {

    // Already connected
    if (socket.partnerId) {
        return;
    }


    // Already waiting
    if (waitingUser === socket.id) {

        socket.emit("waiting");

        return;
    }


    // =================================
    // CHECK WAITING USER
    // =================================

    if (waitingUser) {

        const partner =
            io.sockets.sockets.get(
                waitingUser
            );


        // Waiting user exists
        if (
            partner &&
            partner.id !== socket.id
        ) {

            // Remove waiting user
            waitingUser = null;


            // Save partner IDs
            socket.partnerId =
                partner.id;

            partner.partnerId =
                socket.id;


            console.log(
                "MATCHED:",
                socket.id,
                "<->",
                partner.id
            );


            // IMPORTANT:
            // Send partner ID directly
            // because your index.html expects:
            // socket.on("matched", id => {})


            partner.emit(
                "matched",
                socket.id
            );


            socket.emit(
                "matched",
                partner.id
            );


            return;
        }


        // Waiting user disappeared
        waitingUser = null;

    }


    // =================================
    // WAITING
    // =================================

    waitingUser =
        socket.id;


    socket.emit("waiting");


    console.log(
        "WAITING:",
        socket.id
    );

}


// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {

    console.log(
        "USER CONNECTED:",
        socket.id
    );


    // =================================
    // FIND PARTNER
    // =================================

    socket.on(
        "findPartner",
        () => {

            console.log(
                "FIND PARTNER:",
                socket.id
            );


            findPartner(socket);

        }
    );


    // =================================
    // WEBRTC SIGNAL
    // =================================

    socket.on(
        "signal",
        (data) => {

            /*
             Your index.html sends:

             socket.emit("signal", {
                 type: "offer",
                 offer: offer
             });

             Therefore server must read:
             data.type
             data.offer
             */


            if (!socket.partnerId) {

                console.log(
                    "No partner for signal:",
                    socket.id
                );

                return;
            }


            const partner =
                io.sockets.sockets.get(
                    socket.partnerId
                );


            if (!partner) {

                console.log(
                    "Partner not found:",
                    socket.partnerId
                );

                return;
            }


            // Forward signal exactly as received

            partner.emit(
                "signal",
                {
                    from: socket.id,
                    signal: data
                }
            );


            console.log(
                "SIGNAL:",
                data.type,
                socket.id,
                "->",
                socket.partnerId
            );

        }
    );


    // =================================
    // NEXT
    // =================================

    socket.on(
        "next",
        () => {

            console.log(
                "NEXT:",
                socket.id
            );


            // Remove from waiting
            if (
                waitingUser ===
                socket.id
            ) {

                waitingUser = null;

            }


            // Save old partner
            const oldPartnerId =
                socket.partnerId;


            // Remove own partner
            socket.partnerId =
                null;


            // =================================
            // TELL OLD PARTNER
            // =================================

            if (oldPartnerId) {

                const oldPartner =
                    io.sockets.sockets.get(
                        oldPartnerId
                    );


                if (oldPartner) {

                    oldPartner.partnerId =
                        null;


                    oldPartner.emit(
                        "partnerDisconnected"
                    );

                }

            }


            // =================================
            // FIND NEW PARTNER
            // =================================

            setTimeout(
                () => {

                    if (
                        io.sockets.sockets.has(
                            socket.id
                        )
                    ) {

                        findPartner(socket);

                    }

                },
                200
            );

        }
    );


    // =================================
    // STOP
    // =================================

    socket.on(
        "stop",
        () => {

            console.log(
                "STOP:",
                socket.id
            );


            // Remove waiting
            if (
                waitingUser ===
                socket.id
            ) {

                waitingUser = null;

            }


            // Old partner
            const oldPartnerId =
                socket.partnerId;


            // Clear own partner
            socket.partnerId =
                null;


            // Tell partner
            if (oldPartnerId) {

                const partner =
                    io.sockets.sockets.get(
                        oldPartnerId
                    );


                if (partner) {

                    partner.partnerId =
                        null;


                    partner.emit(
                        "partnerDisconnected"
                    );

                }

            }

        }
    );


    // =================================
    // TEXT CHAT
    // =================================

    socket.on(
        "chatMessage",
        (message) => {

            if (!socket.partnerId) {
                return;
            }


            const partner =
                io.sockets.sockets.get(
                    socket.partnerId
                );


            if (partner) {

                partner.emit(
                    "chatMessage",
                    message
                );

            }

        }
    );


    // =================================
    // REPORT
    // =================================

    socket.on(
        "reportUser",
        (reportData) => {

            console.log(
                "REPORT:",
                socket.id
            );

            console.log(
                "Partner:",
                socket.partnerId
            );

            console.log(
                "Reason:",
                reportData
            );

        }
    );


    // =================================
    // DISCONNECT
    // =================================

    socket.on(
        "disconnect",
        () => {

            console.log(
                "USER DISCONNECTED:",
                socket.id
            );


            // Remove waiting
            if (
                waitingUser ===
                socket.id
            ) {

                waitingUser = null;

            }


            // Get partner
            const partnerId =
                socket.partnerId;


            // Tell partner
            if (partnerId) {

                const partner =
                    io.sockets.sockets.get(
                        partnerId
                    );


                if (partner) {

                    partner.partnerId =
                        null;


                    partner.emit(
                        "partnerDisconnected"
                    );

                }

            }

        }
    );

});


// =====================================
// SERVER START
// =====================================

const PORT =
    process.env.PORT || 3000;


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
            "       PORT:",
            PORT
        );

        console.log(
            "===================================="
        );

    }
);
```
