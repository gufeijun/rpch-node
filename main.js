'use strict';

const rpch = require("./rpch");

let server=rpch.createServer();


class MathService {
    async Add(a, b) {
        throw "No implementation";
    }
};

class Math extends MathService{
    async Add(a, b) {
        return a + b;
    }
}

let math = new Math();

let methods = {
    async Add(args){
        if (args.length != 2) throw "invalid argument cnt";
        if (args[0].name != "int32"||args[0].data.length!=4) throw "invalid type";
        if (args[1].name != "int32"||args[1].data.length!=4) throw "invalid type";
        let data = Buffer.from(args[0].data);
        let arg1 = data.readInt32LE();
        data = Buffer.from(args[1].data);
        let arg2 = data.readInt32LE();
        let res =await math.Add(arg1, arg2);
        data = Buffer.alloc(4);
        data.writeInt32LE(res);
        let resp = {
            typeKind: 0,
            nameLen: 5,
            dataLen: 4,
            name: "int32",
            data: data,
        }
        return resp;
    }
};

let service = {
    name: "math",
    methods:methods,
}

server.register(service);

server.listen(8080, "127.0.0.1", () => {
    console.log("server listening at 127.0.0.1:8080");
})