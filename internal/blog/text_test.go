package blog

import (
	"strings"
	"testing"
)

func TestMarkdownToTextStripsFrontMatterHTMLAndMath(t *testing.T) {
	t.Parallel()

	source := "---\ntitle: 数据库系统概念Day01\ndate: 2024-06-22 00:00:00\n---\n# 数据库系统概念 学习笔记 Day01\n\n> 本笔记记录粗略学习内容\n\n正文 <sup>上标</sup> 与 <mark>重点</mark>。\n\n公式 $\\lim_{x \\to 0} f(x)$ 不应污染摘要。"
	if !HasFrontMatter(source) {
		t.Fatal("front matter not detected")
	}

	text := MarkdownToText(source)
	for _, unexpected := range []string{"title:", "date:", "<sup>", "<mark>", "\\lim", "$"} {
		if strings.Contains(text, unexpected) {
			t.Fatalf("markdown text still contains %q: %q", unexpected, text)
		}
	}
	for _, expected := range []string{"数据库系统概念 学习笔记 Day01", "本笔记记录粗略学习内容", "上标", "重点"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("markdown text missing %q: %q", expected, text)
		}
	}

	if !LooksLikeFrontMatterExcerpt("title: old generated excerpt") {
		t.Fatal("front matter excerpt was not detected")
	}
	if LooksLikeFrontMatterExcerpt("手工摘要 title: 保留") {
		t.Fatal("manual excerpt was misdetected")
	}
}
