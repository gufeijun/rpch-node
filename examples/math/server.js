const mathRPCH = require('./math.rpch');
const rpch = require("../../rpch");

//服务端继承Math服务的接口，实现具体的服务
class MathImpl extends mathRPCH.MathInterface {
    // arg1: uint32
    // arg2: uint32
    // ret:  uint32
    async Add(arg1, arg2) {
        return arg1 + arg2;
    }
    // arg1: int32
    // arg2: int32
    // ret:  int32
    async Sub(arg1, arg2) {
        return arg1 - arg2;
    }
    // arg1: TwoNum
    // ret:  int32
    async Multiply(arg1) {
        return arg1.A * arg1.B;
    }
    // arg1: uint64
    // arg2: uint64
    // ret:  Quotient
    async Divide(arg1, arg2) {
        return {
            Quo: parseInt(arg1 / arg2),
            Rem: arg1 % arg2,
        }
    }
}

//生成rpc服务器
let svr = rpch.createServer();

//给服务器注册Math这个服务，这个注册函数由编译器生成
mathRPCH.registerMathService(svr, new (MathImpl));

svr.listen(8080, "127.0.0.1", () => {
    console.log(`server listening at 127.0.0.1:8080`);
});