# NOTICE

Auroradio 使用了以下第三方项目或服务。各项目版权归其原作者所有。

## Upstream Project（上游项目）

Auroradio 基于 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）修改而成：

- 原项目的界面视觉设计、启动动画方向、粒子视觉体验、电影镜头系统等产品表达，版权归原作者所有。
- Auroradio 的修改部分（lx-music 音源搜索/歌单对接、目录结构调整、品牌更名及配套改动）由 Auroradio 贡献者提供，同样以 GPL-3.0 发布。
- 原 "Mineradio" 名称与 MR Logo 属于原作者，Auroradio 已更换为独立的名称与图标，不继续使用原品牌资产。

## Ported Code（移植代码）

- 音源搜索与歌单对接（`services/lx-music-search.js`、`services/lx-music-songlist.js`）：移植自 [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) `src/renderer/utils/musicSdk`（Apache-2.0）。Copyright (C) lx-music-desktop authors。按 Apache-2.0 与 GPL-3.0 的兼容条款并入本项目，整体仍以 GPL-3.0 发布。

## Third-party Libraries

- Electron
- Three.js
- GSAP
- music-tempo
- NeteaseCloudMusicApi
- mpg123-decoder

## Community Contributions

- Cuefield AutoMix planner/runtime: adapted for experimental local testing from [SLYysl/cuefield-mineradio](https://github.com/SLYysl/cuefield-mineradio) (GPL-3.0). The optional remote-feedback component from that repository is not included; Auroradio stores Cuefield ratings locally in the current user's data directory.
- Wallpaper Engine local-library detection and import UX: independently adapted from the approach used by [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) at commit `a5ef80a219709080700be5b1d00f1ea71a5a2576` (GPL-3.0). Auroradio only indexes local `project.json` metadata; it does not execute imported Web/Application projects or replace the user's existing background-media settings.
- Full-desktop main-window mode and home-dashboard information hierarchy: initially adapted from [ww085213/Mineradio-LX-Music](https://github.com/ww085213/Mineradio-LX-Music) at commit `82826df814c32853d99697c0ee60f749a2fcad79`, with the homepage refreshed against `812e2dc2e18bbc263e61dbd0206cb765e003d6e9` (GPL-3.0). Auroradio keeps its own provider, queue, playlist, listening-history, WorkerW validation, DPI, lifecycle, and cleanup implementations; see `docs/THIRD_PARTY_PORTS.md` in the corresponding source distribution.
- Qishui Passport Web QR authentication bridge: focused port from [Wx2yZx/Mineradio-Qishui-QR-Login](https://github.com/Wx2yZx/Mineradio-Qishui-QR-Login) at commit `aaadaab7d011714f94fbe45b382ba8dcc7cf17b9` (declared `GPL-3.0-only`). Only the official QR create/poll, security-signing host, session persistence, and second-verification path are integrated; Auroradio keeps its own catalogue, playlist, entitlement, and playback adapters. The bundled ByteDance/Qishui web security runtime resources remain the property of their respective rights holders and are used only to interoperate with the user's own official account session.

## Third-party Services

Auroradio 可能与网易云音乐、QQ 音乐等第三方音乐服务进行用户自有账号相关的本地客户端交互。

Auroradio 不是任何音乐平台的官方客户端，也不隶属于网易云音乐、QQ 音乐或腾讯音乐娱乐集团。请用户自行遵守对应平台的服务协议、版权规则和会员权益规则。Auroradio 本身不提供任何音源，相关音乐平台功能需用户使用自有账号并自行承担合规责任。

## Copyright & License

Auroradio — 基于 Mineradio 修改的 Windows 桌面沉浸式音乐播放器。
Copyright (C) 2026 Auroradio contributors；原项目各部分版权归其原作者所有。

本程序为自由软件：你可根据自由软件基金会发布的 GNU 通用公共许可证（第 3 版或更高版本）重新分发或修改它。详见根目录 `LICENSE` 文件。

## Acknowledgements

emily 作为本项目早期视觉底层想法与 `emily` 视觉预设改进方向的共创者和灵感来源之一，特此致谢。

感谢小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦在早期体验、测试反馈和发布准备中的帮助。
