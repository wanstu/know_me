package blog

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

var (
	frontMatter        = regexp.MustCompile("(?s)^---[ \\t]*\\r?\\n.*?\\r?\\n(?:---|\\.\\.\\.)[ \\t]*\\r?\\n")
	fencedCode         = regexp.MustCompile("(?s)\\x60\\x60\\x60.*?\\x60\\x60\\x60")
	blockMath          = regexp.MustCompile("(?s)\\$\\$.*?\\$\\$")
	inlineMath         = regexp.MustCompile("\\$[^$\\r\\n]+\\$")
	inlineCode         = regexp.MustCompile("\\x60([^\\x60]+)\\x60")
	imageLink          = regexp.MustCompile("!\\[[^\\]]*\\]\\([^)]+\\)")
	textLink           = regexp.MustCompile("\\[([^\\]]+)\\]\\([^)]+\\)")
	htmlTag            = regexp.MustCompile("<[^>]+>")
	heading            = regexp.MustCompile("(?m)^[ \\t]*#{1,6}\\s+")
	markers            = regexp.MustCompile("[*_~>|-]")
	space              = regexp.MustCompile("\\s+")
	frontMatterExcerpt = regexp.MustCompile("(?i)^\\s*(title|date)\\s*:")
	leadingH1          = regexp.MustCompile("^[ \\t]*#[ \\t]+(.+?)[ \\t]*#?[ \\t]*$")
)

func MarkdownToText(markdown string) string {
	value := frontMatter.ReplaceAllString(markdown, " ")
	value = fencedCode.ReplaceAllString(value, " ")
	value = blockMath.ReplaceAllString(value, " ")
	value = inlineMath.ReplaceAllString(value, " ")
	value = inlineCode.ReplaceAllString(value, "$1")
	value = imageLink.ReplaceAllString(value, " ")
	value = textLink.ReplaceAllString(value, "$1")
	value = htmlTag.ReplaceAllString(value, "")
	value = heading.ReplaceAllString(value, "")
	value = markers.ReplaceAllString(value, " ")
	value = space.ReplaceAllString(value, " ")
	return strings.TrimSpace(value)
}

func HasFrontMatter(markdown string) bool {
	return frontMatter.MatchString(markdown)
}

func LooksLikeFrontMatterExcerpt(excerpt string) bool {
	return frontMatterExcerpt.MatchString(excerpt)
}

func ExcerptFrom(markdown string) string {
	return ExcerptFromTitle(markdown, "")
}

func ExcerptFromTitle(markdown, title string) string {
	value := markdown
	if strings.TrimSpace(title) != "" {
		lines := strings.Split(frontMatter.ReplaceAllString(value, ""), "\n")
		for index, line := range lines {
			match := leadingH1.FindStringSubmatch(line)
			if match == nil {
				if strings.TrimSpace(line) == "" {
					continue
				}
				break
			}
			if strings.EqualFold(strings.TrimSpace(match[1]), strings.TrimSpace(title)) {
				lines = append(lines[:index], lines[index+1:]...)
			}
			break
		}
		value = strings.Join(lines, "\n")
	}
	runes := []rune(MarkdownToText(value))
	if len(runes) > 180 {
		return string(runes[:177]) + "..."
	}
	return string(runes)
}

func NormalizeSlug(value string) string {
	value = strings.ToLower(strings.TrimSpace(norm.NFKC.String(value)))
	var out []rune
	lastDash := false
	for _, r := range value {
		switch {
		case unicode.IsSpace(r):
			if len(out) > 0 && !lastDash {
				out = append(out, '-')
				lastDash = true
			}
		case unicode.IsLetter(r) || unicode.IsNumber(r) || r == '_':
			out = append(out, r)
			lastDash = false
		case r == '-':
			if len(out) > 0 && !lastDash {
				out = append(out, r)
				lastDash = true
			}
		}
	}
	for len(out) > 0 && out[len(out)-1] == '-' {
		out = out[:len(out)-1]
	}
	if len(out) == 0 {
		return "post"
	}
	return string(out)
}
