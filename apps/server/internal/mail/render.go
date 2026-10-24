// Package mail builds and renders the roster email (docs/ux-spec.md §6.8). The HTML part is a
// Go html/template rendered from apps/email's React Email component and committed; the plain-text
// part is a hand-written text/template. Sending is elsewhere.
package mail

import (
	"embed"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
)

//go:embed templates/roster.html.tmpl templates/roster.txt.tmpl
var templates embed.FS

var (
	htmlTmpl = htmltemplate.Must(htmltemplate.ParseFS(templates, "templates/roster.html.tmpl"))
	textTmpl = texttemplate.Must(texttemplate.ParseFS(templates, "templates/roster.txt.tmpl"))
)

// RosterEmail is the view the templates fill. Every value is precomputed, colours included,
// because the HTML template's actions hold no literals (React escapes quotes when it renders).
type RosterEmail struct {
	Subject   string // "New roster: 26 Oct – 22 Nov"
	Preheader string // hidden preview text
	Range     string // the heading, "Mon 26 Oct – Sun 22 Nov 2026"
	Summary   string // "17 working shifts over four weeks."
	Weeks     []Week
}

// Week is one Monday-to-Sunday block of rows.
type Week struct {
	Title string // "Week of Mon 26 Oct"
	Rows  []Row
}

// Row is one date. The style fields are CSS colours, a font weight and a border, each a whole CSS
// property value in the HTML template.
type Row struct {
	Date  string // "Mon 26 Oct"
	Code  string // the shift code, or "–" for an unrostered date
	Label string // "Night", an Other code's letters, or "Not rostered"

	ChipBg, ChipFg, ChipLine string
	LabelFg, LabelWeight     string
	DateFg, RowBg, RowLine   string
}

// Render fills the HTML and plain-text templates with e.
func Render(e RosterEmail) (html, text string, err error) {
	var h, t strings.Builder
	if err := htmlTmpl.Execute(&h, e); err != nil {
		return "", "", err
	}
	if err := textTmpl.Execute(&t, e); err != nil {
		return "", "", err
	}
	return h.String(), t.String(), nil
}
