# Linux CLI Debian 安装与 systemd

自 `v0.1.8-rc.1` 起，Know Me Linux CLI 已额外发布 `know-me-vX.Y.Z-linux-amd64.deb` 和对应的 `.sha256`。此处不是 Wails Desktop 的 `know-me-desktop-...deb`。

使用 Kit v0.11.3 的 `desktopkit package linux --systemd` 生成包。目标平台为 systemd 系统上的 Debian / Ubuntu amd64，不依赖桌面图形库。

## 首次安装

```bash
sudo apt install ./know-me-vX.Y.Z-linux-amd64.deb
know-me service status
curl -fsS http://127.0.0.1:3000/api/health
```

安装完成后：
- 命令为 `/usr/bin/know-me`，Debian 软件包名是 `know-me-cli`。
- systemd unit 是 **`know-me-cli.service`**，首次安装自动 enable/start，重装或升级尝试重启。
- 服务以独立的非特权用户和组 `know-me-cli` 运行，工作目录为 `/var/lib/know-me-cli`。
- SQLite、访问白名单在 `/var/lib/know-me-cli/data`，上传文件在 `/var/lib/know-me-cli/uploads`。
- 默认监听 `0.0.0.0:3000`，不默认限制域名/IP（可在站点后台单独启用访问白名单）。
- 卸载、purge 和覆盖升级**不删除** `/var/lib/know-me-cli` 中的持久化数据。

调整监听端口（比如设为 8003）可以使用 systemd override，不需要修改 Kit 或重打包：

```bash
sudo systemctl edit know-me-cli
```

加入：

```ini
[Service]
Environment="KNOW_ME_LISTEN=0.0.0.0:8003"
```

保存后执行：

```bash
sudo systemctl daemon-reload
know-me service restart
know-me service status
journalctl -u know-me-cli -n 100 --no-pager
```

## 管理与升级

```bash
know-me service status
know-me service start
know-me service stop
know-me service restart
know-me service enable
know-me service disable
sudo apt install ./know-me-vNEXT-linux-amd64.deb
sudo apt purge know-me-cli
```

请在升级前备份数据库和媒体文件。升级会尝试重启服务，但不会主动迁移其它安装方式的数据。

## 既有服务器注意事项

**此包不会接管原先手工部署的 `know-me.service`。** 比如已有 `/home/admin/tool/know-me`、`/home/admin/data/know-me` 和服务端口 8002，它们不会因为安装此 deb 被删除或导入。新包会以 `know-me-cli.service` 和独立数据目录启动**另一个实例**，使用默认 3000 端口。

如需替换现有线上服务，必须先制定迁移步骤：备份原数据库和 uploads、核对拥有者/权限，确认端口与反向代理路由，再停止旧服务并迁移。不要直接安装后将新实例误认为旧站点的数据丢失。

## 发布流程与验证

- `scripts/package-linux-cli-deb.sh`：从已编译的 Linux CLI 二进制生成 Debian 包及 SHA256 校验文件；rc 版本使用 `~rc.N` 以正确遵守 Debian 版本排序。
- `.github/workflows/release.yml`：Linux CLI 构建完毕后自动调用 Kit 打包，并将 `.deb` 与 `.sha256` 合并进 Release，强制校验文件存在及哈希。
- `.github/workflows/linux-cli-deb.yml`：隔离的 Ubuntu runner 中真实验证 apt 安装、systemd 自启动、HTTP 健康检查、重新安装、purge 后数据留存。

正式发布 `v0.1.7` 不包含此安装包，`v0.1.8-rc.1` 的 CLI 二进制也不支持 `know-me service` 命令。后续包含 Kit `v0.11.3` 的候选版本才支持这些命令。发布前必须经真实已安装 CLI 的 Linux E2E 验证。
