package main

import (
	"io"
	"os"
	"strings"
	"testing"
)

func captureCLIOutput(t *testing.T, args ...string) (string, error) {
	t.Helper()
	original := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	defer func() {
		os.Stdout = original
		_ = reader.Close()
		_ = writer.Close()
	}()
	runErr := run(args)
	_ = writer.Close()
	os.Stdout = original
	body, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return string(body), runErr
}

func TestChineseCLIHelpAndServiceHelp(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want []string
	}{
		{"top help", []string{"-h"}, []string{"Know Me 原生服务端", "服务管理", "环境变量", "know-me service --help"}},
		{"top help alias", []string{"help"}, []string{"启动选项", "管理员初始化选项"}},
		{"service no args", []string{"service"}, []string{"Know Me Linux 服务管理", "只管理", "know-me-cli.service"}},
		{"service short help", []string{"service", "-h"}, []string{"服务管理", "enable", "disable"}},
		{"service long help", []string{"service", "--help"}, []string{"查询状态无需", "运行状态", "sudo"}},
		{"service help word", []string{"service", "help"}, []string{"不影响旧版", "know-me.service"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := captureCLIOutput(t, tc.args...)
			if err != nil {
				t.Fatal(err)
			}
			for _, piece := range tc.want {
				if !strings.Contains(got, piece) {
					t.Fatalf("help text missing %q: %q", piece, got)
				}
			}
		})
	}
}

func TestServiceCommandRejectsInvalidOrExtraArguments(t *testing.T) {
	for _, args := range [][]string{
		{"service", "status", "--all"},
		{"service", "erase"},
	} {
		_, err := captureCLIOutput(t, args...)
		if err == nil || !strings.Contains(err.Error(), "know-me service --help") {
			t.Fatalf("got %v, want service usage hint", err)
		}
	}
}
