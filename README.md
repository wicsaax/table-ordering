# 桌边点餐 · 自有服务器演示版

按店内价目表制作的移动端适配点餐网页。可以部署在普通 Nginx 服务器，访问无需 ChatGPT 账号。

## 已实现

六类菜单、中份和大份、购物车、数量调整、备注、演示下单、继续加菜和本桌累计金额。菜单中模糊菜名和手写价格已标注待核对。

## 当前范围

这是网页原型。桌号固定为 01；订单只保存在当前页面内存，刷新清空。未接入微信小程序、真实桌码、数据库、支付、店员后台、厨房打印或跨设备同步。不能直接用于营业。演示按餐后结账设计。

## 本地开发

安装 Node.js 22.13+（建议 24 LTS），在项目目录执行：

```sh
npm ci
npm run dev
```

## 构建

```sh
npm ci
npm run build
```

生成的 `dist/` 是完整静态网站。服务器只需要 Nginx，无需 Node.js 常驻。2G 内存服务器可使用随交付提供的已构建静态包，跳过服务器编译。

## Ubuntu 24.04 首次部署

以下命令用于你自己的服务器。先在控制台确认当前操作的是目标服务器，保留已有网站配置。随交付提供的 `ordering-static.tar.gz` 是编译好的网站。将该包上传到服务器登录用户的主目录后执行：

```sh
sudo apt-get update
sudo apt-get install -y nginx
sudo install -d /var/www/table-ordering
tar -tzf ~/ordering-static.tar.gz
sudo tar -xzf ~/ordering-static.tar.gz -C /var/www/table-ordering
```

将本仓库 `deploy/nginx.conf` 上传为服务器上的 `~/table-ordering.conf`，再执行：

```sh
sudo install -m 644 ~/table-ordering.conf /etc/nginx/conf.d/table-ordering.conf
sudo nginx -t
```

只有上一步提示测试成功后，执行：

```sh
sudo systemctl enable --now nginx
sudo systemctl reload nginx
curl -I http://127.0.0.1:8080/
```

在阿里云实例的安全组中添加入方向 TCP 8080 规则。试用时来源限制为自己的公网 IP；向顾客开放前再规划正式访问规则。若服务器启用了 UFW，还需放行相应端口；不要关闭整个防火墙。

浏览器访问 `http://你的公网IP:8080/`。此端口为演示用途，不在这里输入支付信息或登录密码。原型没有个人账户和收费功能。

## 从 GitHub 获取源码

在已获仓库访问权限的开发电脑上执行，将示例占位符替换成实际仓库地址：

```sh
git clone https://github.com/wicsaax/table-ordering.git
cd table-ordering
npm ci
npm run build
```

将 `dist/` 内容上传至 `/var/www/table-ordering/`。私有仓库需先通过 GitHub 登录或配置 SSH 密钥。不要把访问令牌、SSH 私钥、服务器密码放进仓库。

## 正式营业前需要完成

- 店主核对菜名、价格和规格。
- 数据库保存订单、后端计算金额、避免重复提交。
- 店员登录、接单、出餐、退款和结账。
- 每次用餐独立记录，防止下一桌顾客看到上一桌订单。
- 域名、HTTPS、备份与恢复。
- 微信小程序及需要时的微信支付接入。

## 验证范围

自有服务器版本执行 TypeScript 检查及 Vite 生产构建，静态页面 HTTP 检查。未连接用户服务器、未验证真实微信链路、未执行浏览器交互测试。可选 WebMCP 选菜接口尚未进行支持环境下的合约验证。
