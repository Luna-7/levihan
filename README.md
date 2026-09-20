# 🥔 利韩土豆仓 · Levi × Hange

> 💚💜 Only Levi × Hange.
> 一个因为喜欢利威尔和韩吉而存在的小小角落。

这里没什么特别的。

只是喜欢利威尔和韩吉，
所以想把喜欢的东西慢慢收集起来。

放一点资源，存一点粮，
聊一点喜欢的话题，
偶尔再玩点奇怪的小游戏。

**一起吃点粮，仅此而已。**

---

## 🌿 在线访问

### → [利韩土豆仓](https://levihan.vercel.app)

建议使用现代浏览器访问。

项目针对桌面端与移动端进行了适配，也支持作为 PWA 安装到设备。

---

## 🏕️ 这里有什么

### 🗺️ 巨人资源

整理与 Levi / Hange / LeviHan 相关的公共资源。

包括但不限于：

* 动画 CUT
* 官方资料
* AO3
* Pixiv 画师整理
* 其他公开资源入口

希望可以让刚开始找粮的人少翻一点山。

---

### 📚 土豆粮仓

同人资源整理区。

目前主要用于整理：

* 利韩同人本
* 汉化 / 精修资源
* 画册
* A–Z 分类存档
* 资源说明与防倒卖规范

这里只负责整理与分享信息。

**请尊重原作者、汉化者、修图者以及所有参与资源整理的人。**

---

### ⚔️ 塔塔开

兵团娱乐室。

一些直接运行在网页里的 LeviHan 小游戏。

目前项目内包含独立的游戏构建与入口，并支持通过 URL 参数直接进入对应分区。

例如：

```text
?tab=tatakaru
```

部分游戏还可以继续通过参数直接进入指定内容。

---


## 🛠️ 技术栈

|               |                       |
| ------------- | --------------------- |
| Framework     | React 19              |
| Language      | TypeScript            |
| Build Tool    | Vite                  |
| CSS           | Tailwind CSS          |
| Icons         | Lucide React          |
| PWA           | vite-plugin-pwa       |
| Analytics     | Vercel Analytics      |
| Deploy        | Vercel                |
| Storage / API | AWS S3 Compatible SDK |

---

## 📁 项目结构

```text
levihan/
├── api/                        # API
├── archive/                    # 存档相关内容
├── assets/
│   └── ui-sprite-sources/      # UI Sprite 原始素材
├── cloudbase/                  # 云端相关配置 / 能力
├── docs/                       # 项目文档
├── public/                     # 静态资源
├── scripts/                    # 构建 / 同步脚本
│
├── src/
│   ├── components/
│   │   ├── GroupHome           # 土豆群主页
│   │   ├── ResourceHub         # 公共资源库
│   │   ├── DoujinshiArchive    # 土豆粮仓
│   │   ├── TatakaruGame        # 塔塔开游戏区
│   │   ├── HeaderCard
│   │   └── RetroPixelFrame
│   │
│   ├── data/                   # 页面数据
│   ├── utils/                  # 音效等工具
│   ├── App.tsx                 # 主应用
│   └── main.tsx                # 应用入口
│
├── .env.example
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vercel.json
```

> 项目仍然在持续调整中，实际目录可能随版本变化。

---

## 🚀 本地运行

需要：

```text
Node.js
npm
```

克隆项目：

```bash
git clone https://github.com/Luna-7/levihan.git
cd levihan
```

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

默认地址：

```text
http://localhost:3000
```

---

## 📦 构建

构建生产版本：

```bash
npm run build
```

本地预览构建结果：

```bash
npm run preview
```

TypeScript 检查：

```bash
npm run lint
```

---

## 🎮 游戏独立开发

项目中的部分游戏内容拥有独立的 Vite 构建配置。

开发：

```bash
npm run dev:save-hange
```

默认运行在：

```text
http://localhost:3001
```

单独构建：

```bash
npm run build:save-hange
```

---

## 🔗 页面直达

主页面支持通过 `tab` 参数直接进入分区：

```text
/?tab=resources
/?tab=doujinshi
/?tab=tatakaru
```

因此可以直接分享某个区域，而不必每次从主页进入。

---

## 🥔 关于这个项目

这个项目不是为了做一个非常正式的网站。

它最开始、现在以及以后，大概都只是因为：

> **喜欢利威尔和韩吉。**

想把散落在不同地方的东西整理起来。

想让一些已经很难找到的内容还有地方可以被看见。

也想给还在喜欢他们的人留一个可以偶尔回来逛逛的小角落。

如果你也是因为 Levi 和 Hange 来到这里——

**欢迎回家。**

💚 `Levi Ackerman` × `Hange Zoë` 💜

---

## ⚠️ 版权与声明

本项目为 **《进击的巨人 / Attack on Titan》相关非官方同人爱好者项目**，与原作者、出版社、动画制作委员会及其他官方机构无关联。

《进击的巨人》及相关角色、名称、图像等权利归各自权利方所有。

站内整理的同人作品、图片、翻译及其他创作内容，其版权归对应原作者 / 创作者所有。

本项目不主张拥有这些内容的版权。

如有资源：

* 不适合公开展示
* 存在授权问题
* 需要修改署名
* 希望移除

请通过项目 Issue 或其他可联系渠道告知。

**禁止利用本站整理资源进行倒卖或未经授权的商业用途。**

---

## 🤝 Contribution

这是一个私人兴趣驱动的项目，因此暂时没有严格的 Contribution 流程。

如果发现：

* 页面 Bug
* 移动端显示问题
* 失效链接
* 资源信息错误
* 错别字
* 其他奇怪的土豆问题

欢迎提交 Issue。

---

## 💚💜

```text
Levi × Hange

这里没什么特别的。

就是喜欢利威尔和韩吉。

所以放一些喜欢的东西，
聊一点喜欢的话题，
一起吃点粮。

仅此而已。
```

🥔
