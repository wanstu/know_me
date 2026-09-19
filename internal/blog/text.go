package blog

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

var (
	fencedCode = regexp.MustCompile("(?s)```.*?```")
	inlineCode = regexp.MustCompile("`([^`]+)`")
	imageLink  = regexp.MustCompile("!\\[[^\\]]*\\]\\([^)]+\\)")
	textLink   = regexp.MustCompile("\\[([^\\]]+)\\]\\([^)]+\\)")
	heading    = regexp.MustCompile("(?m)^#{1,6}\\s+")
	markers    = regexp.MustCompile("[*_~>|-]")
	space      = regexp.MustCompile("\\s+")
)

func MarkdownToText(markdown string) string {
	value := fencedCode.ReplaceAllString(markdown, " ")
	value = inlineCode.ReplaceAllString(value, "$1")
	value = imageLink.ReplaceAllString(value, " ")
	value = textLink.ReplaceAllString(value, "$1")
	value = heading.ReplaceAllString(value, "")
	value = markers.ReplaceAllString(value, " ")
	value = space.ReplaceAllString(value, " ")
	return strings.TrimSpace(value)
}

func ExcerptFrom(markdown string) string {
	runes := []rune(MarkdownToText(markdown))
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
