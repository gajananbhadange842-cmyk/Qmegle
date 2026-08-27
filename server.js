const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server);


// =====================================
// WEBSITE FILES
// =====================================

app.use(express.static(__dirname));


// =====================================
// WAITING USER
// =====================================

let waitingUser = null;


// =====================================
// SOCKET CONNECTION
// =====================================

io.on("connection", (socket) => {

    console.log("=================================");
    console.log("User connected:", socket.id);
    console.log("=================================");


    // =================================
    // FIND PARTNER
    // =================================

    socket.on("findPartner", () => {

        console.log(
            "Find partner:",
            socket.id
        );


        // अगर पहले से partner है
        if (socket.partner) {

            console.log(
                "User already has partner:",
                socket.id
            );

            return;
        }


        // अगर कोई waiting user है
        if (
            waitingUser &&
            waitingUser !== socket.id
        ) {

            const partnerId =
                waitingUser;


            waitingUser = null;


            const partnerSocket =
                io.sockets.sockets.get(
                    partnerId
                );


            // Partner मौजूद है
            if (partnerSocket) {

                socket.partner =
                    partnerId;

                partnerSocket.partner =
                    socket.id;


                // दोनों users को match बताना

                socket.emit(
                    "matched",
                    partnerId
                );


                partnerSocket.emit(
                    "matched",
                    socket.id
                );


                console.log(
                    "🎉 Users matched:",
                    socket.id,
                    partnerId
                );

            }

            // Partner नहीं मिला
            else {

                waitingUser =
                    socket.id;


                socket.emit(
                    "waiting"
                );

            }

        }

        // कोई waiting user नहीं
        else {

            waitingUser =
                socket.id;


            socket.emit(
                "waiting"
            );


            console.log(
                "⏳ User waiting:",
                socket.id
            );

        }

    });


    // =================================
    // WEBRTC SIGNAL
    // =================================

    socket.on(
        "signal",
        (data) => {

            if (!socket.partner) {

                return;
            }


            const partnerSocket =
                io.sockets.sockets.get(
                    socket.partner
                );


            if (partnerSocket) {

                partnerSocket.emit(
                    "signal",
                    {
                        from: socket.id,

                        signal: data
                    }
                );

            }

        }
    );


    // =================================
    // TEXT CHAT
    // =================================

    socket.on(
        "chatMessage",
        (message) => {

            if (!socket.partner) {

                return;
            }


            const partnerSocket =
                io.sockets.sockets.get(
                    socket.partner
                );


            if (partnerSocket) {

                partnerSocket.emit(
                    "chatMessage",
                    message
                );


                console.log(
                    "💬 Message:",
                    socket.id,
                    "->",
                    socket.partner,
                    message
                );

            }

        }
    );


    // =================================
    // NEXT USER
    // =================================

    socket.on(
        "next",
        () => {

            console.log(
                "⏭️ Next:",
                socket.id
            );


            // अगर waiting में था
            if (
                waitingUser ===
                socket.id
            ) {

                waitingUser = null;

            }


            // पुराना partner
            if (socket.partner) {

                const oldPartnerId =
                    socket.partner;


                const partnerSocket =
                    io.sockets.sockets.get(
                        oldPartnerId
                    );


                // अपना partner हटाएँ
                socket.partner =
                    null;


                // दूसरे user को बताएं
                if (partnerSocket) {

                    partnerSocket.partner =
                        null;


                    partnerSocket.emit(
                        "partnerDisconnected"
                    );

                }

            }


            socket.partner =
                null;


            // नया partner खोजें
            findNewPartner(socket);

        }
    );


    // =================================
    // REPORT USER
    // =================================

    socket.on(
        "reportUser",
        (reportData) => {

            console.log("");
            console.log(
                "🚨 ==============================="
            );

            console.log(
                "🚨 NEW REPORT"
            );

            console.log(
                "Reporter:",
                socket.id
            );

            console.log(
                "Reported User:",
                socket.partner
            );


            // अगर report object है
            if (
                typeof reportData ===
                "object"
            ) {

                console.log(
                    "Reason:",
                    reportData.reason
                );

            }

            // अगर सिर्फ reason भेजा गया
            else {

                console.log(
                    "Reason:",
                    reportData
                );

            }


            console.log(
                "🚨 ==============================="
            );

            console.log("");

        }
    );


    // =================================
    // DISCONNECT
    // =================================

    socket.on(
        "disconnect",
        () => {

            console.log(
                "❌ User disconnected:",
                socket.id
            );


            // Waiting user हटाएँ

            if (
                waitingUser ===
                socket.id
            ) {

                waitingUser =
                    null;

            }


            // Partner को बताएं

            if (socket.partner) {

                const partnerSocket =
                    io.sockets.sockets.get(
                        socket.partner
                    );


                if (partnerSocket) {

                    partnerSocket.partner =
                        null;


                    partnerSocket.emit(
                        "partnerDisconnected"
                    );

                }

            }

        }
    );

});


// =====================================
// FIND NEW PARTNER FUNCTION
// =====================================

function findNewPartner(socket) {

    console.log(
        "🔎 Finding new partner:",
        socket.id
    );


    // अगर दूसरा waiting user है

    if (
        waitingUser &&
        waitingUser !== socket.id
    ) {

        const partnerId =
            waitingUser;


        waitingUser =
            null;


        const partnerSocket =
            io.sockets.sockets.get(
                partnerId
            );


        if (partnerSocket) {

            // दोनों को connect करें

            socket.partner =
                partnerId;


            partnerSocket.partner =
                socket.id;


            socket.emit(
                "matched",
                partnerId
            );


            partnerSocket.emit(
                "matched",
                socket.id
            );


            console.log(
                "🎉 New users matched:",
                socket.id,
                partnerId
            );

        }

        else {

            waitingUser =
                socket.id;


            socket.emit(
                "waiting"
            );

        }

    }

    // कोई दूसरा user नहीं
    else {

        waitingUser =
            socket.id;


        socket.emit(
            "waiting"
        );


        console.log(
            "⏳ Waiting for new partner:",
            socket.id
        );

    }

}


// =====================================
// START SERVER
// =====================================

server.listen(
    3000,
    () => {

        console.log("");
        console.log(
            "================================="
        );

        console.log(
            "🚀 Qmegle Server Started"
        );

        console.log(
            "🌐 http://localhost:3000"
        );

        console.log(
            "================================="
        );

        console.log("");

    }
);