# 动画代号 · 队长选牌版（同屏 + 联机）

这是对 [动画代号 Anime Code](https://anicode.logicry.cc/) 的个人改造版。原版由 B 站 UP 主 [_LogiCry](https://space.bilibili.com/7666716) 制作，数据来自 [Bangumi](https://bangumi.tv)，玩法灵感来自桌游 Codenames。

## 改了什么

- 开局不再由系统随机分配红/蓝/中立/刺客。
- **红队队长选 9 部、蓝队队长选 8 部**，两队不能选同一部动画。
- 剩余 8 张从牌池随机补齐：**7 张中立 + 1 张刺客**，位置随机。
- 同屏版有完整的隐私交接；联机版两位队长在各自设备上选牌，猜词人只看到暗牌。
- 保留了原版的牌桌、封面/字号/上色、作品详情、行动记录、分享长图、结算奖项、手机布局。
- 联机版额外支持：6 位房间号、邀请链接、红蓝座位、准备/开始、房间聊天、断线重连、房主回大厅/取消选牌。

## 联机版（新，推荐和朋友一起玩）

需要电脑上有 Node.js（本项目用 Node 26 测试）。在本目录运行：

```powershell
node online-server.mjs
```

然后打开 <http://127.0.0.1:8090/>，输入昵称创建房间，把房间号或邀请链接发给朋友。

- **4 人起**：红队队长 + 红队猜词人 + 蓝队队长 + 蓝队猜词人。
- 两位队长在各自设备上私密选牌；双方队长能看到已选（防止撞牌），猜词人只看到暗牌。
- 选满后自动进入对局：红队先出题，猜词人翻牌，翻到对方/中立回合结束，先找齐本队全部动画获胜，踩到刺客判负。
- 房主可以开始游戏、取消选牌、结束后回大厅；聊天在房间和对局侧栏都能用。
- 服务端直接读取完整 `anime_list.json`，按原版默认筛选（约 1,145 部候选），所以联机也是完整牌池，不依赖每个玩家下载 5 MB 数据。

### 让外网朋友加入

同一 Wi-Fi 下：把 `http://你的内网IP:8090/` 发给朋友（服务器绑定 `0.0.0.0`）。

外网临时：在电脑上开一个 SSH 隧道（需要本机开着）：

```powershell
ssh -T -o StrictHostKeyChecking=no -R 80:localhost:8090 nokey@localhost.run
```

终端会输出一个 `https://xxxx.lhr.life` 地址，把它发给朋友即可。隧道关掉/电脑关机地址就失效。

永久联机需要把 `online-server.mjs` 部署到**支持 WebSocket 的 Node 主机**（Render、Railway、Fly.io、VPS 等），不能用纯静态托管（GitHub Pages 不行）。

### 联机版目前的边界

已经能用：房间/座位/准备/开始、队长选牌、出题/翻牌/结束回合、胜负结算、房间聊天、断线重连、再来一局。

还没做（原站有，但本版暂未实现）：公开房间列表、观战席、回合计时器、多人投票、Bangumi 收藏筛选、队长禁牌、房间号隐藏、成员管理。需要的话可以继续加。

## 同屏版

```powershell
node server.mjs
```

打开 <http://127.0.0.1:8080/>（完整牌池）。不想开服务器时也可以直接双击 `index.html`，会退回内置的 200 部精选牌池。

同屏流程：红队队长选 9 部 → 换蓝队队长选 8 部 → 队长地图确认 → 交给红队队长先出题 → 猜词人翻牌。

## URL / 文件

### 联机服务器 `online-server.mjs`

- `/`：联机版入口
- `/local`：同屏版
- `/api/create`、`/api/join`：建房/加入
- `/ws`：房间 WebSocket
- 依赖 `ws`（`node_modules/ws` 已随包提供；删掉后运行 `npm install` 即可）

### 同屏服务器 `server.mjs`

- `/`：同屏版
- 支持 gzip；`$env:SKIP_DATA=1` 可强制使用 200 部内置牌池
- 纯静态，不需要 `ws`

### 主要文件

| 文件 | 作用 |
| --- | --- |
| `index.html` / `styles.css` / `app.js` | 同屏版页面、样式、渲染 |
| `game.js` | 纯规则；`createDraft()` 生成队长选牌后的牌阵 |
| `online.html` / `online.css` / `online.js` | 联机页面、房间大厅、选牌、对局 |
| `online-server.mjs` | 联机房间服务器（Node + ws） |
| `server.mjs` | 同屏静态服务器 |
| `multiplayer.js` / `entry.js` | 原版官方联机大厅（保留，`?online`） |
| `fallback-data.js` | 200 部精选牌池 |
| `anime_list.json` | 13,398 部完整数据 |
| `tests/draft.test.mjs` | 选牌规则测试：`node --test tests/draft.test.mjs` |

## 想再改

- **选牌数量**：`game.js` 的 `createDraft()` 与 `app.js` 顶部 `DRAFT` 的 `count`、`online.js` 的 `totalFor()` 要一起改。
- **联机默认牌池**：`online-server.mjs` 的 `POOL = G.filter(DATA, G.defaults, G.dataDate)`。
- **联机入口文案/座位**：`online.js` 的 `renderLobby()`。
- **同屏版加回官方联机入口**：`index.html` 底部 `自建联机版` 链接改回原站即可。

## 说明

- 原项目未附开源许可证；本改造仅供个人学习、自用，请保留原站、原作者和 Bangumi 的署名，不要商用。
- 联机服务器是内存态：进程重启后房间消失，正在进行的对局会断。
- 数据是 2026-10-31 的快照。
