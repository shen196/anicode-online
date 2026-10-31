# 把联机版部署成永久网址

联机版是 **Node + WebSocket** 服务，不能用 GitHub Pages 纯静态托管。最省钱的方案是：

**GitHub 存代码 → Render 免费 Web Service 跑服务**，得到 `https://xxxx.onrender.com` 永久地址。

> 下文的“G站”按 **GitHub** 写。如果是 **Gitee（码云）**，Render 也可以尝试用「Public Git repository」填公开仓库地址，但 GitHub 最稳。

---

## 第一步：把代码传到 GitHub

1. 解压 `anicode-github.zip`。
2. 打开 GitHub，右上角 **+ → New repository**：
   - Repository name：`anicode-online`
   - Public / Private 都可以
   - **不要**勾选 Add README
   - Create repository
3. 进入空仓库，点 **Add file → Upload files**。
4. 把解压出来的**所有文件**（不是外层文件夹）拖进去：
   - `online-server.mjs`、`online.html`、`online.css`、`online.js`
   - `index.html`、`styles.css`、`app.js`、`game.js`、`demo.js`、`entry.js`、`multiplayer.js`
   - `fallback-data.js`、`anime_list.json`
   - `server.mjs`（可选，同屏版用）
   - `package.json`、`package-lock.json`、`render.yaml`
   - `README.md`、`DEPLOY.md`
5. 等 `anime_list.json`（约 7 MB）上传完，点 **Commit changes**。

> 不要上传 `node_modules`、`screenshots`、`*.zip`。Render 会自动 `npm install`。

---

## 第二步：Render 部署

1. 打开 <https://render.com>，用 **GitHub 账号登录/注册**（Sign in with GitHub），授权访问仓库。
2. 右上角 **New +**：
   - 如果能看到 **Blueprint**：选 Blueprint → 选中 `anicode-online` 仓库 → Apply。`render.yaml` 已经写好配置。
   - 如果只想手动建：选 **Web Service** → 连接 `anicode-online` 仓库。
3. 手动配置时填：
   - Name：`anicode-online`
   - Region：**Singapore**（国内访问相对近）
   - Branch：`main`
   - Runtime：`Node`
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Instance Type：**Free**
4. 点 **Create Web Service**，等日志出现 `Live`。
5. 页面顶部会给你一个地址，形如：

   **https://anicode-online.onrender.com**

   打开它，就是联机版入口。

---

## 第三步：和朋友玩

1. 打开 Render 地址，输入昵称，**创建房间**。
2. 点「复制邀请链接」，把带 `?room=房间号` 的链接发给朋友。
3. 4 人分别坐：红队队长、红队猜词人、蓝队队长、蓝队猜词人。
4. 都点准备，房主点开始；红队长先选 9 部，蓝队长再选 8 部。

---

## 重要说明

- **免费实例会休眠**：Render 免费服务约 15 分钟无请求会休眠；有人打开页面/WebSocket 会自动唤醒，第一次可能要等 30–60 秒。
- **房间是内存态**：Render 重启/休眠后房间会消失，重新创建房间即可。
- **免费额度**：每月 750 小时，一个免费服务够用。
- **GitHub Pages 不行**：它只能放静态文件，跑不了 Node/WebSocket 联机服务器。
- **自定义域名**：Render → 服务 → Settings → Custom Domains，添加你的域名并按提示配 CNAME；HTTPS 自动签发。
- **国内访问慢/打不开**：Render 新加坡节点通常可用；如果网络不稳定，换国内云服务器（见下）。

---

## 备选：国内云服务器（更稳，需付费）

适合长期玩、朋友都在国内。

1. 买一台轻量应用服务器：腾讯云/阿里云 **2 核 2G，Ubuntu 22.04**（约 ¥24–60/月）。
2. 安全组/防火墙放行 **8090** 端口。
3. SSH 登录服务器，安装 Node 20：

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v
   ```

4. 把 `anicode-github.zip` 上传到服务器（面板上传或 `scp`），解压：

   ```bash
   unzip anicode-github.zip -d anicode
   cd anicode
   npm install
   node online-server.mjs
   ```

5. 浏览器打开：

   ```text
   http://服务器公网IP:8090/
   ```

6. 用 pm2 常驻：

   ```bash
   sudo npm i -g pm2
   pm2 start online-server.mjs --name anicode
   pm2 save
   pm2 startup
   ```

7. 想用自己的域名 + HTTPS，用 Nginx 反代（WebSocket 必须加 Upgrade 头）：

   ```nginx
   server {
     listen 80;
     server_name 你的域名;
     location / {
       proxy_pass http://127.0.0.1:8090;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
     }
   }
   ```

   然后 `sudo certbot --nginx -d 你的域名` 申请证书。

---

## 常见报错

| 现象 | 处理 |
| --- | --- |
| Render 构建失败 | 确认 `package.json` 在仓库根目录，Build `npm install`，Start `npm start` |
| 打开 502 / Application failed | 看 Render Logs；一般是 Start Command 不是 `npm start` 或端口没监听 |
| 页面能开但房间连不上 | 必须用 Render 的 `https://` 地址；WebSocket 会自动走 `wss://`；不要用本地文件打开 |
| 房间不存在 | 服务重启/休眠过，房间是内存态；重新创建 |
| 第一次打开很慢 | Render 免费实例冷启动，等 30–60 秒 |
| 朋友打不开 | 先确认朋友能打开 Render 根地址；国内网络问题就换国内 VPS |
