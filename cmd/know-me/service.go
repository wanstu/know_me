package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/wanstu/wails-desktop-kit/servicecontrol"
)

const knowMeServiceUnit = "know-me-cli.service"

// serviceCommand controls only the service installed by Know Me CLI's Debian
// package, never an existing manually installed know-me.service.
func serviceCommand(args []string) error {
	if len(args) == 0 || (len(args) == 1 && (args[0] == "-h" || args[0] == "--help" || args[0] == "help")) {
		printServiceHelp()
		return nil
	}
	if len(args) != 1 {
		return fmt.Errorf("服务管理参数不正确；请执行 know-me service --help")
	}
	action := args[0]
	if !strings.Contains("|"+servicecontrol.Actions+"|", "|"+action+"|") {
		return fmt.Errorf("不支持服务操作 %q；请执行 know-me service --help", action)
	}
	if err := servicecontrol.Run(context.Background(), knowMeServiceUnit, action, os.Stdout, os.Stderr); err != nil {
		return fmt.Errorf("操作 %s 失败：%w\n提示：此命令仅管理 Debian 安装的 %s；非 root 用户可能需要 sudo 授权", action, err, knowMeServiceUnit)
	}
	return nil
}

func printServiceHelp() {
	fmt.Print(`Know Me Linux 服务管理

用法：
  know-me service <操作>

操作：
  status    查看服务运行状态和开机自启状态
  start     启动服务
  stop      停止服务
  restart   重启服务
  enable    设置开机自启（不等于立即启动）
  disable   取消开机自启（不等于立即停止）
  help      显示本帮助（也可用 -h 或 --help）

说明：
  · 只管理 .deb 安装的 know-me-cli.service。
  · 不影响旧版或手工部署的 know-me.service。
  · 查询状态无需管理员权限；更改服务状态可能需要输入 sudo 密码。
  · 安装 .deb 时已自动启动服务并设置开机自启，无需额外操作。
`)
}
