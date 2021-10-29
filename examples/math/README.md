```shell
hgen -dir . -lang node math.gfj
```

执行完后生成math.rpch.js文件，客户端以及服务端引入此文件。

服务端实现服务接口。

客户端进行服务调用。

测试：

```shell
# 服务端
node ./server.js

#客户端
node ./client.js
```



