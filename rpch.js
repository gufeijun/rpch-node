'use strict';
const net = require('net');

const readReqLine = 1;
const readReqArg = 2;
const MAGIC = 0x00686a6c;

class NonSeriousErr extends Error {
    constructor(msg) {
        super(msg);
    }
}

class Context {
    constructor(conn) {
        this.conn = conn;
        this.state = readReqLine;
        this.buf = '';
        this.Request = null;
        this.readMagic = false;
    }
}

class Argument {
    constructor(typeKind, nameLen, dataLen) {
        this.typeKind = typeKind;
        this.nameLen = nameLen;
        this.dataLen = dataLen;
    }
}

class Request {
    constructor(service, method, argCnt, seq) {
        this.service = service;
        this.method = method;
        this.argCnt = argCnt;
        this.seq = seq;
        this.args = [];
        this.curArg = null;
    }
}

function sendResponse(conn, seq, typeKind, name, data) {
    let head = Buffer.alloc(16);
    // node version >= v12.0.0
    head.writeBigUInt64LE(BigInt(seq), 0);
    head.writeUInt16LE(typeKind, 8);
    head.writeUInt16LE(name.length, 10);
    head.writeUInt32LE(data.length, 12);
    conn.write(head);
    conn.write(name);
    conn.write(data);
}

class Server {
    constructor() {
        this.#services = {};
        this.#tcpServer = net.createServer(sock => {
            let ctx = new Context(sock);
            sock.on('data', chunk => {
                this.#handleChunk(ctx, chunk).catch(e => {
                    console.log(e.message);
                    ctx.conn.destroy();
                });
            })
            sock.on('error', err => {
                sock.destroy();
                console.log(err.message);
            })
        });
    }
    #readReqLine(ctx) {
        let index = ctx.buf.indexOf('\r\n');
        if (index == -1) {
            if (ctx.buf.length >= 4096) throw 'request line is too large';
            return;
        }
        let arr = ctx.buf.substr(0, index).split(' ');
        if (arr.length != 4) throw 'invalid request line';
        ctx.request =
            new Request(arr[0], arr[1], parseInt(arr[2]), parseInt(arr[3]));
        ctx.state = readReqArg;
        ctx.buf = ctx.buf.substr(index + 2);
    }
    #readReqArgs(ctx) {
        while (1) {
            if (ctx.request.args.length == ctx.request.argCnt) {
                ctx.state = readReqLine;
                return;
            }
            if (ctx.curArg == null) {
                if (ctx.buf.length < 8) return;
                let head = Buffer.from(ctx.buf.substr(0, 8));
                let typeKind = head.readUInt16LE();
                let nameLen = head.slice(2).readUInt16LE();
                let dataLen = head.slice(4).readUInt32LE();
                ctx.curArg = new Argument(typeKind, nameLen, dataLen);
                ctx.buf = ctx.buf.substr(8);
            }
            let arg = ctx.curArg;
            if (ctx.buf.length < arg.nameLen + arg.dataLen) return;

            arg.name = ctx.buf.substr(0, arg.nameLen);
            arg.data = ctx.buf.substr(arg.nameLen, arg.dataLen);
            ctx.buf = ctx.buf.substr(arg.nameLen + arg.dataLen);
            ctx.request.args.push(arg);
            ctx.curArg = null;
        }
    }
    async #handleRequest(ctx) {
        let req = ctx.request;
        let service = this.#services[req.service];
        if (service == undefined) throw 'invalid service';
        let method = service.methods[req.method];
        if (method == undefined) throw 'invalid method';
        try {
            let resp = await method(req.args);
            sendResponse(
                ctx.conn, req.seq, resp.typeKind, resp.name, resp.data);
        } catch (e) {
            //仅当用户抛出NonSeriousErr时我们将此错误当做消息返回给客户端
            //当抛出其他错误时，我们关闭客户端的链接
            if (e instanceof NonSeriousErr) {
                sendResponse(ctx.conn, req.seq, 3, '', e.message);
            } else {
                throw e;
            }
        }
    }
    async #handleChunk(ctx, chunk) {
        ctx.buf += chunk.toString();
        if (ctx.buf.length < 4) return;
        if (!ctx.readMagic) {
            let magicBuf = Buffer.from(ctx.buf.substr(0, 4));
            if (magicBuf.readUInt32LE() != MAGIC) throw 'invalid magic number';
            ctx.buf = ctx.buf.substr(4);
            ctx.readMagic = true;
        }
        while (1) {
            switch (ctx.state) {
                case readReqLine:
                    this.#readReqLine(ctx);
                    if (ctx.state == readReqLine) return;
                case readReqArg:
                    this.#readReqArgs(ctx);
                    if (ctx.state == readReqArg) return;
                    await this.#handleRequest(ctx);
            }
        }
    }
    #services;
    #tcpServer;
    register(service) {
        this.#services[service.name] = service;
    }
    listen(port, host, cb) {
        this.#tcpServer.listen(port, host, cb);
    }
}

class Client {
    constructor(conn) {
        this.conn = conn;
        this.seq = 0;
        this.tasks = {};
        // pending task seq
        this.msg = "";
        this.curResp = null;
        conn.on("data", chunk => {
            this.msg += chunk;
            this.#readResponse();
        });
    }
    #readResponse() {
        while (1) {
            if (this.curResp == null) {
                if (this.msg.length < 16) return;
                let buff = Buffer.from(this.msg.substr(0, 16));
                this.curResp = {
                    seq: Number(buff.readBigUInt64LE()),
                    typeKind: buff.slice(8, 10).readUInt16LE(),
                    nameLen: buff.slice(10, 12).readUInt16LE(),
                    dataLen: buff.slice(12, 16).readUInt32LE(),
                }
                this.msg = this.msg.substr(16);
            }
            let resp = this.curResp;
            if (this.msg.length < resp.nameLen + resp.dataLen) return;
            resp.name = this.msg.substr(0, resp.nameLen);
            resp.data = this.msg.substr(resp.nameLen, resp.dataLen);
            this.msg = this.msg.substr(resp.nameLen + resp.dataLen);
            this.curResp = null;
            let cb = this.tasks[resp.seq];
            if (cb == undefined) return;
            delete this.tasks[resp.seq];
            //error return
            if (resp.typeKind == 3) cb(resp, new Error(resp.data));
            else cb(resp,null);
        }
    }
    onError(cb) {
        this.onErrorCb = cb;
    }
    destroy() {
        this.conn.destroy();
    }
    call(req, cb) {
        this.#sendRequest(req);
        this.tasks[this.seq++] = cb;
    }
    #sendRequest(req) {
        let requestLine = `${req.service} ${req.method} ${req.argCnt} ${this.seq}\r\n`;
        this.conn.write(requestLine);
        req.args.forEach(arg => {
            let head = Buffer.alloc(8);
            head.writeUInt16LE(arg.typeKind, 0);
            head.writeUInt16LE(arg.name.length, 2);
            head.writeUInt32LE(arg.data.length, 4);
            this.conn.write(head);
            this.conn.write(arg.name);
            this.conn.write(arg.data);
        });
    }
}

function dial(port, host, cb) {
    let sock = new net.Socket();
    sock.connect(port, host, cb);
    let client = new Client(sock);
    sock.on("error", err => {
        if (client.onErrorCb) {
            client.onErrorCb(err);
        }
    });
    //write magic to server
    let magic = Buffer.alloc(4);
    magic.writeUInt32LE(MAGIC);
    sock.write(magic);
    return client;
}


module.exports = {
    dial,
    createServer: () => {
        return new Server();
    },
    NonSeriousErr: (msg) => {
        return new NonSeriousErr(msg);
    },
}