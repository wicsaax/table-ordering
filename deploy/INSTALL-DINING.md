# 三勾堂食扩展 v0.1：部署验证

本次新增的可部署包：`deploy/jjjshop-dining-v0.1.tar.gz`。包内包含源码、PHP依赖、菜单、安装脚本、来源声明和测试报告。

## 服务器命令（Ubuntu 24.04，root）

```bash
cd ~/table-ordering
git pull
mkdir -p ~/jjjshop-dining-v0.1
tar -xzf deploy/jjjshop-dining-v0.1.tar.gz -C ~/jjjshop-dining-v0.1 --strip-components=1
cd ~/jjjshop-dining-v0.1
bash scripts/install-ubuntu.sh http://39.107.139.208:8081 10
```

最后的 `10` 是桌数，可改成实际桌数（1至100）。安装时自行设置店员密码，至少12位；不使用默认密码。已有`/opt/jjjshop-dining`目录、同名数据库或配置时脚本停止，不会覆盖。

依赖已随包提供，不需要服务器访问Composer；系统安装仍需能访问Ubuntu软件源。旧8080演示保留，新版使用8081。

## 打开验证

安全组放行TCP 8081，先限测试设备公网IP。店员入口：

`http://39.107.139.208:8081/dining/staff.html`

登录后：桌台/结账 → 01桌开桌 → 打开本桌菜单 → 下单 → 店员接单 → 标记出餐 → 追加菜品 → 核对金额 → 已收款并结账。

打印桌码页提供每桌二维码；客人扫码前先由店员开桌。原图模糊菜品默认售罄，确认价格后在菜品页上架。

## 实现范围

复用三勾开源框架、商品/SKU/桌台/订单表结构、二维码库，新增轻量单店堂食模块及手机页面；没有启用原商城前端或支付系统。实际下单写数据库，刷新保留。

手机页面打开时可声音提醒，锁屏推送尚未接入。餐后结账只记录线下已收款，不扣款。对外营业前需配置HTTPS、备份、核对菜单及真实手机/高峰测试。

本地26项数据库检查和HTTP完整链路已通过；Ubuntu安装、Nginx/FPM与真机扫码仍需你部署验收。包内`TEST-REPORT.md`列出具体范围。
