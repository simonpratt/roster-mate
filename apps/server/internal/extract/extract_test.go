package extract

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

func code(s string) *string { return &s }

func TestValidate(t *testing.T) {
	in := Result{
		PersonFound: true,
		Shifts: []Proposed{
			{Date: "2026-11-03", Code: code("L"), RawCode: "L"},
			{Date: "2026-02-30", Code: code("D"), RawCode: "D"},
			{Date: "2026-11-04", Code: code("ABC"), RawCode: "ABC"},
			{Date: "2026-11-05", Code: code("SE"), RawCode: "SE", Uncertain: true},
			{Date: "2026-11-06", Code: nil, RawCode: "A/L"},
			{Date: "2026-11-03", Code: code("N"), RawCode: "N"},
			{Date: "3/11/2026", Code: code("E"), RawCode: "E"},
			{Date: "2026-11-07", Code: code("se"), RawCode: "se"},
			{Date: "2026-11-08", Code: nil, RawCode: ""},
		},
		Warnings: []string{"Week of 10 Nov is partly obscured"},
	}
	got := Validate(in)

	want := []Proposed{
		{Date: "2026-11-03", Code: code("L"), RawCode: "L"},
		{Date: "2026-11-05", Code: code("SE"), RawCode: "SE", Uncertain: true},
		{Date: "2026-11-06", Code: nil, RawCode: "A/L"},
		{Date: "2026-11-07", Code: code("SE"), RawCode: "se"},
	}
	if !reflect.DeepEqual(got.Shifts, want) {
		g, _ := json.Marshal(got.Shifts)
		w, _ := json.Marshal(want)
		t.Errorf("shifts = %s\nwant     %s", g, w)
	}
	if !got.PersonFound {
		t.Error("PersonFound lost")
	}
	if len(got.Warnings) != 6 || got.Warnings[0] != "Week of 10 Nov is partly obscured" {
		t.Fatalf("warnings = %q", got.Warnings)
	}
	for _, needle := range []string{`"2026-02-30"`, `"ABC"`, "2026-11-03: kept the first", `"3/11/2026"`, "2026-11-08"} {
		if !strings.Contains(strings.Join(got.Warnings, "\n"), needle) {
			t.Errorf("no warning mentions %s: %q", needle, got.Warnings)
		}
	}
}

func TestValidateEmptyEncodesArrays(t *testing.T) {
	b, _ := json.Marshal(Validate(Result{}))
	if string(b) != `{"personFound":false,"shifts":[],"warnings":[]}` {
		t.Errorf("got %s", b)
	}
}

func TestBuildPrompt(t *testing.T) {
	p := BuildPrompt("Simon Pratt", time.Date(2026, 10, 15, 23, 30, 0, 0, time.Local))
	for _, needle := range []string{
		`"Simon Pratt"`,
		"2026-10-15",
		"- D: Day", "- E: Early", "- L: Late", "- N: Night", "- X: Day off",
		"Any other cell of one or two letters is that code in uppercase, an Other code",
		"Date each shift by the day it starts",
		"a Night shift that runs past midnight belongs to the date it starts on",
		"set code to null and put the cell's text in rawCode",
		"set personFound to false",
		"uncertain",
	} {
		if !strings.Contains(p, needle) {
			t.Errorf("prompt lacks %q", needle)
		}
	}
	// AM and PM are two letters, so the synonym rule must come before the Other-code rule.
	syn, other := strings.Index(p, "Map AM to E"), strings.Index(p, "Any other cell of one or two letters")
	if syn < 0 || other < 0 || syn > other {
		t.Errorf("synonym rule (at %d) must come before the Other-code rule (at %d)", syn, other)
	}
	for _, s := range []string{"OFF", "RDO", `"/"`, "PM to L"} {
		if !strings.Contains(p[:other], s) {
			t.Errorf("synonym %s missing before the Other-code rule", s)
		}
	}
}
