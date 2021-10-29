# 介绍

rpch-node是rpch框架的node实现，更多详细信息可参考[rpch-go](https://github.com/gufeijun/rpch-go)。

使用async以及await，服务端接口方法以及客户端调用支持全异步。

# 使用

启动一个最简单的rpc服务器：

**1. 创建IDL文件**:

新建math.gfj：

```protobuf
//math.gfj
service Math{
    int32 Add(int32,int32)
}
```

使用[hgen](https://github.com/gufeijun/hgen)编译器对其进行编译：`hgen -dir . -lang node ./math.gfj`。

即会在当前目录下生成`math.rpch.js`文件，其中定义了服务端应该提供服务的接口，客户端的调用api。

hgen编译器的介绍以及IDL的语法见[hgen](https://github.com/gufeijun/hgen)。

**2. 服务端实现**

server.js:

```js
//引入此库
const rpch = require("rpch");
//引入编译器生成的文件
const mathRPCH = require("./math.rpch");

//继承Math服务接口，实现具体服务
class MathServiceImpl extends mathRPCH.MathInterface{
    //实现Add方法
	async Add(arg1, arg2) {
        return arg1 + arg2;
	}
}

//建立服务端
let svr = rpch.createServer();

//注册服务
mathRPCH.registerMathService(svr, new (MathServiceImpl));

//开始监听
svr.listen(8080, "127.0.0.1", () => {
    console.log("server is listening at 127.0.0.1:8080");
})
```

对用用户来说，只需要实现具体的服务并将其注册即可。

**3. 客户端实现**

client.js:

```js
//引入此库
const rpch = require("rpch");
//引入编译器生成的文件
const mathRPCH = require("./math.rpch");

//发起rpc链接
let conn = rpch.dial(8080, "127.0.0.1");

conn.onError(err => {
    console.log(err);
})

//使用自动生成的函数将此rpc连接转化为请求Math服务的client对象
let client = new mathRPCH.MathClient(conn);

//发起异步请求
(async()=> {
    try {
        //调用异步Add方法
        let res = await client.Add(-1, 2);
        if (res != 1) {
            console.log(`want ${1} but got ${res}`);
            process.exit(1);
        }
        console.log("test success!");
    } catch (e) {
        console.log(e);
    } finally {
        conn.destroy();
    }
})()
```

客户端在得到rpch连接后，使用编译器生成的函数就可以将其转化为访问具体服务的对象，该对象绑定了所有访问这个服务的方法。

更多的案例见[examples](https://github.com/gufeijun/rpch-node/tree/master/examples)。

# 注意事项

请勿在rpch-node中使用IDL的stream类型，stream目前仅对rpch-go实现。

如果一个服务返回值或者传递参数是一个对象时，且该对象具有整数成员，请务必保证nodejs服务端的实现中将所有整数成员使用`parseInt`将可能出现的浮点数转化为整数。否则会导致跨语言通讯时出现错误。

# 安装

```shell
npm i rpch
```

或者

直接下载本仓库的rpch.js文件，项目中引入即可。