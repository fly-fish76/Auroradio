# lx-source

Auroradio 的 lx 音乐自定义音源宿主（Linux/Mac/Windows 桌面端通用音源脚本运行环境的最小子集）。

## 文件

| 文件 | 职责 |
|---|---|
| `host.js` | 音源脚本宿主：脚本生命周期、请求处理、事件分发 |
| `preload.js` | 隔离桥接层（宿主与音源脚本之间的受控通道） |
| `event-names.js` | 事件名常量 |

## 在 Auroradio 中使用

主项目仓库：[fly-fish76/Auroradio](https://github.com/fly-fish76/Auroradio)

宿主由主程序在运行时以独立窗口/环境加载，音源脚本（`user_api.json` 格式）由用户自行导入，本仓库不包含任何具体音源脚本。

## 许可

GPL-3.0-only（与主项目一致）
