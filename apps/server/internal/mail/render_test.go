package mail

import (
	"strings"
	"testing"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

var today = time.Date(2026, 10, 24, 9, 0, 0, 0, time.UTC)

// sample is the design's four weeks, 26 Oct – 22 Nov 2026 (RosterEmailMessage.dc.html), with
// "" for the one unrostered date (Fri 20 Nov).
func sample() (first, last string, shifts map[string]string) {
	weeks := []string{"N N X X D D E", "E L L X X N N", "N X X SE D D X", "L L E X - D X"}
	shifts = map[string]string{}
	d := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	for _, w := range weeks {
		for _, c := range strings.Fields(w) {
			if c != "-" {
				shifts[d.Format(dateLayout)] = c
			}
			d = d.AddDate(0, 0, 1)
		}
	}
	return "2026-10-26", "2026-11-22", shifts
}

func TestRenderSample(t *testing.T) {
	first, last, shifts := sample()
	e := BuildRosterEmail(first, last, shifts, today)
	html, text, err := Render(e)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html, "ZgotmplZ") {
		t.Fatal("html contains ZgotmplZ: a template action was rejected")
	}
	for _, want := range []string{
		"<title>New roster: 26 Oct – 22 Nov</title>",
		`<meta name="color-scheme" content="light"/>`,
		`<meta name="supported-color-schemes" content="light"/>`,
		"Mon 26 Oct – Sun 22 Nov 2026",
		"18 working shifts over four weeks.",
		"18 working shifts, 26 Oct – 22 Nov",
		"Week of Mon 26 Oct", "Week of Mon 16 Nov",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("html lacks %q", want)
		}
	}

	rows := 0
	for _, w := range e.Weeks {
		for _, r := range w.Rows {
			rows++
			for _, want := range []string{">" + r.Date + "<", ">" + r.Code + "<", ">" + r.Label + "<"} {
				if !strings.Contains(html, want) {
					t.Errorf("html lacks %q", want)
				}
			}
		}
	}
	if rows != 28 {
		t.Fatalf("got %d rows, want 28", rows)
	}

	lines := strings.Split(text, "\n")
	if lines[0] != e.Subject {
		t.Errorf("text starts %q, want the subject", lines[0])
	}
	for _, want := range []string{"Mon 26 Oct  N  Night", "Wed 28 Oct  X  Day off", "Thu 12 Nov  SE  SE", "Fri 20 Nov  –  Not rostered"} {
		if n := countLine(lines, want); n != 1 {
			t.Errorf("text has %d lines %q, want 1", n, want)
		}
	}
	dated := 0
	for _, l := range lines {
		if strings.Count(l, "  ") == 2 {
			dated++
		}
	}
	if dated != 28 {
		t.Errorf("text has %d date lines, want 28:\n%s", dated, text)
	}
}

func TestOtherAndUnrosteredRows(t *testing.T) {
	first, last, shifts := sample()
	e := BuildRosterEmail(first, last, shifts, today)
	se := e.Weeks[2].Rows[3]
	if se.Date != "Thu 12 Nov" || se.Code != "SE" || se.Label != "SE" {
		t.Fatalf("row = %+v, want Thu 12 Nov SE SE", se)
	}
	if se.ChipBg != otherChip.bg || se.ChipFg != otherChip.fg {
		t.Errorf("SE chip = %s/%s, want the Other colours", se.ChipBg, se.ChipFg)
	}
	html, _, err := Render(e)
	if err != nil {
		t.Fatal(err)
	}
	wantChip := "border-color:" + otherChip.line + ";border-radius:6px;background-color:" + otherChip.bg + ";color:" + otherChip.fg
	if !strings.Contains(html, wantChip+";") || !strings.Contains(html, ">SE</div>") {
		t.Errorf("html lacks the SE chip in the Other colours")
	}

	un := e.Weeks[3].Rows[4]
	if un.Date != "Fri 20 Nov" || un.Code != "–" || un.Label != "Not rostered" {
		t.Errorf("row = %+v, want Fri 20 Nov unrostered", un)
	}
	if !strings.Contains(html, ">Not rostered<") {
		t.Error("html lacks Not rostered")
	}
}

func TestWeekendRowsAndFirstRowLine(t *testing.T) {
	first, last, shifts := sample()
	w := BuildRosterEmail(first, last, shifts, today).Weeks[0]
	for i, r := range w.Rows {
		want := weekdayBg
		if i >= 5 {
			want = weekendBg
		}
		if r.RowBg != want {
			t.Errorf("row %d bg = %s, want %s", i, r.RowBg, want)
		}
	}
	if w.Rows[0].RowLine != "0" || w.Rows[1].RowLine != rowLine {
		t.Errorf("row lines = %q, %q", w.Rows[0].RowLine, w.Rows[1].RowLine)
	}
}

func TestSubjectYear(t *testing.T) {
	cases := []struct {
		first, last, want, heading string
	}{
		{"2026-10-26", "2026-11-22", "New roster: 26 Oct – 22 Nov", "Mon 26 Oct – Sun 22 Nov 2026"},
		{"2026-12-28", "2027-01-24", "New roster: 28 Dec – 24 Jan 2027", "Mon 28 Dec 2026 – Sun 24 Jan 2027"},
		{"2027-01-04", "2027-01-31", "New roster: 4 Jan – 31 Jan 2027", "Mon 4 Jan – Sun 31 Jan 2027"},
	}
	for _, c := range cases {
		e := BuildRosterEmail(c.first, c.last, nil, today)
		if e.Subject != c.want {
			t.Errorf("%s–%s subject = %q, want %q", c.first, c.last, e.Subject, c.want)
		}
		if e.Range != c.heading {
			t.Errorf("%s–%s range = %q, want %q", c.first, c.last, e.Range, c.heading)
		}
	}
}

func TestSummary(t *testing.T) {
	e := BuildRosterEmail("2026-10-26", "2026-11-01", map[string]string{"2026-10-28": "D", "2026-10-29": "X"}, today)
	if e.Summary != "1 working shift over one week." {
		t.Errorf("summary = %q", e.Summary)
	}
	if e.Preheader != "1 working shift, 26 Oct – 1 Nov" {
		t.Errorf("preheader = %q", e.Preheader)
	}
	for n, want := range map[int]string{2: "two weeks", 10: "ten weeks", 11: "11 weeks"} {
		if got := weeksPhrase(n); got != want {
			t.Errorf("weeksPhrase(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestEveryStandardCodeHasChipColours(t *testing.T) {
	for _, c := range store.StandardCodes {
		if _, ok := chips[c.Code]; !ok {
			t.Errorf("no chip colours for %s", c.Code)
		}
	}
	if len(chips) != len(store.StandardCodes) {
		t.Errorf("chips has %d codes, store has %d", len(chips), len(store.StandardCodes))
	}
}

func countLine(lines []string, want string) int {
	n := 0
	for _, l := range lines {
		if l == want {
			n++
		}
	}
	return n
}
