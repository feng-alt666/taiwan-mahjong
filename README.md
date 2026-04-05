# 🀄 台灣麻將 多人連線

Mario Kart 角色 × 完整台灣麻將規則 × 即時多人連線

## 本機運行

```bash
npm install
npm start
# 開啟 http://localhost:3001
```

## Railway 部署

1. 將此資料夾推上 GitHub
2. 到 [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. 選擇此 repo，Railway 自動偵測 Node.js 並部署
4. 部署完成後，Railway 會給你一個 `https://xxx.railway.app` 網址

## 遊戲說明

- 第一個進入的玩家為房主，可設定底數/台數
- 房主點「開始遊戲」後，空位自動補 AI
- 其他玩家輸入 4 碼房間碼，或直接點分享連結加入
