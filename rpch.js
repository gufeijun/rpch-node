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

class buffer{
    constructor(size) {
        //已缓存数据的起始
        this.front = 0;
        //已缓存数据的末尾
        this.rear = 0;
        this.buf = Buffer.allocUnsafe(size);
    }
    drop(size) {
        this.front += size;
    }
    buffered() {
        return this.rear - this.front;
    }
    slice(start, end) {
        if (!end) end = this.buffered();
        return this.buf.slice(this.front + start, this.front + end);
    }
    fill(chunk) {
        //当空余空间(不包含0~front) >= chunk size
        if (this.buf.length - this.rear >= chunk.length) {
            chunk.copy(this.buf,this.rear,0,chunk.length);
        }
        //当空余空间(包含0~front) >= chunk size
        else if (this.buf.length + this.front - this.rear >= chunk.length) {
            this.buf.copy(this.buf, 0, this.front, this.rear);
            this.rear -= this.front;
            this.front = 0;
            chunk.copy(this.buf,this.rear,0,chunk.length);
        } else {
            this.buf = Buffer.concat([this.buf.slice(this.front, this.rear), chunk]);
            this.rear -= this.front;
        }
        this.rear += chunk.length;
    }
}

class Context {
    constructor(conn) {
        this.conn = conn;
        this.state = readReqLine;
        this.buf = new buffer(8192);
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
        let buffered = ctx.buf.slice(0);
        let index = buffered.indexOf('\r\n');
        if (index == -1) {
            if (ctx.buf.buffered() >= 4096) throw 'request line is too large';
            return;
        }
        let arr = buffered.slice(0, index).toString().split(' ');
        if (arr.length != 4) throw 'invalid request line';
        ctx.request =
            new Request(arr[0], arr[1], parseInt(arr[2]), parseInt(arr[3]));
        ctx.state = readReqArg;
        ctx.buf.drop(index + 2);
    }
    #readReqArgs(ctx) {
        while (1) {
            if (ctx.request.args.length == ctx.request.argCnt) {
                ctx.state = readReqLine;
                return;
            }
            if (ctx.curArg == null) {
                if (ctx.buf.buffered() < 8) return;
                let head = ctx.buf.slice(0, 8);
                let typeKind = head.readUInt16LE();
                let nameLen = head.slice(2).readUInt16LE();
                let dataLen = head.slice(4).readUInt32LE();
                ctx.curArg = new Argument(typeKind, nameLen, dataLen);
                ctx.buf.drop(8);
            }
            let arg = ctx.curArg;
            if (ctx.buf.buffered() < arg.nameLen + arg.dataLen) return;

            arg.name = ctx.buf.slice(0,arg.nameLen).toString();
            arg.data = ctx.buf.slice(arg.nameLen, arg.nameLen+arg.dataLen);
            ctx.buf.drop(arg.nameLen+arg.dataLen);
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
        ctx.buf.fill(chunk);
        if (ctx.buf.buffered() < 4) return;
        if (!ctx.readMagic) {
            if (ctx.buf.slice(0,4).readUInt32LE() != MAGIC) throw 'invalid magic number';
            ctx.readMagic = true;
            ctx.buf.drop(4);
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
        this.buf = new buffer(8192);
        this.curResp = null;
        conn.on("data", chunk => {
            this.buf.fill(chunk);
            this.#readResponse();
        });
    }
    #readResponse() {
        while (1) {
            if (this.curResp == null) {
                if (this.buf.buffered() < 16) return;
                this.curResp = {
                    seq: Number(this.buf.slice(0,8).readBigUInt64LE()),
                    typeKind: this.buf.slice(8,10).readUInt16LE(),
                    nameLen: this.buf.slice(10, 12).readUInt16LE(),
                    dataLen: this.buf.slice(12, 16).readUInt32LE(),
                }
                this.buf.drop(16);
            }
            let resp = this.curResp;
            if (this.buf.buffered() < resp.nameLen + resp.dataLen) return;
            resp.name = this.buf.slice(0, resp.nameLen).toString();
            resp.data = this.buf.slice(resp.nameLen, resp.nameLen+resp.dataLen);
            this.buf.drop(resp.nameLen + resp.dataLen);
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