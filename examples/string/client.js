const stringRPCH = require('./string.rpch');
const rpch = require("../../rpch");

//发起对服务端的rpc连接
let conn = rpch.dial(8080, "127.0.0.1");

//生成Math服务的客户端，该函数由编译器生成
let client = new stringRPCH.stringClient(conn);

function assert(condition, msg) {
    if (condition) return;
    console.log(msg);
    process.exit(1);
}

(async () => {
    try {
        let res;

        res = await client.toupper("hello");
        assert("HELLO" === res, "toupper failed");

        res = await client.tolower("HELLO");
        assert("hello" === res, "toupper failed");

        res = await client.concat("hello", " world");
        assert("hello world" === res, "concat failed");

        res = await client.atoi("100");
        assert(res === 100, "atio failed");
    } catch (e) {
        console.log(e);
        process.exit(-1);
    }
    try {
        let res = await client.atoi("a100");
    } catch (e) {
        assert(rpch.isNonSeriousErr(e) && e.message == "parseInt failed");
    } finally {
        conn.destroy();
    }
    console.log("test succ!");
})();