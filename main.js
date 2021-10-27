'use strict';

const rpch = require("./rpch");

let server=rpch.createServer();

server.listen(8080, "127.0.0.1", () => {
    console.log("server listening at 127.0.0.1:8080");
})