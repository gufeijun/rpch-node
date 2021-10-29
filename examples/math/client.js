const mathRPCH = require('./math.rpch');
const rpch = require("../../rpch");

//发起对服务端的rpc连接
let conn = rpch.dial(8080, "127.0.0.1");

//生成Math服务的客户端，该函数由编译器生成
let mathClient = new mathRPCH.MathClient(conn);

function assert(condition, msg) {
    if (condition) return;
    console.log(msg);
    process.exit(1);
}

(async () => {
    try {
        let res;

        //客户端只需调用即可
        res = await mathClient.Add(1, 2);
        assert(res === 3, "Add failed");

        res = await mathClient.Sub(-1, 4);
        assert(res === -5, "Sub failed");

        res = await mathClient.Multiply({
            A: -4,
            B: 5
        })
        assert(res == -20, "Multiply failed");

        res = await mathClient.Divide(13, 3);
        assert(res.Quo =4&&res.Rem==1,"Divide failed");

        console.log("test succ!");
    } catch (e) {
        console.log(e);
    } finally {
        conn.destroy();
    }
})();