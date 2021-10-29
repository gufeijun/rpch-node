const rpch = require('../../rpch');
const stringRPCH = require('./string.rpch');

class stringServiceImpl extends stringRPCH.stringInterface{
	// arg1: string
	// ret:  string
	async toupper(str) {
        return str.toUpperCase();
	}
	// arg1: string
	// ret:  string
	async tolower(str) {
        return str.toLowerCase();
	}
	// arg1: string
	// arg2: string
	// ret:  string
	async concat(arg1, arg2) {
        return arg1 + arg2;
	}
	// arg1: string
	// ret:  int32
	async atoi(arg1) {
        let res = parseInt(arg1);
        //抛出NonSeriousErr不会关闭掉客户端的链接
        //服务端会将此错误传递给客户端
        if (isNaN(res)) throw rpch.NonSeriousErr("parseInt failed");
        return res;
	}
}

//生成rpc服务器
let svr = rpch.createServer();

//给服务器注册Math这个服务，这个注册函数由编译器生成
stringRPCH.registerstringService(svr, new (stringServiceImpl));

svr.listen(8080, "127.0.0.1", () => {
    console.log(`server listening at 127.0.0.1:8080`);
});