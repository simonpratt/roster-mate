// Package extract reads one person's proposed shifts from a roster photo. It stores nothing:
// the result is a proposal the phone reviews before any shift is saved.
package extract

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

// Extractor reads the configured person's shifts from a roster image. mediaType is
// image/jpeg, image/png or image/webp.
type Extractor interface {
	Extract(ctx context.Context, img []byte, mediaType string) (Result, error)
}

// Result is what an extraction proposes. PersonFound is false when the roster has no row for
// the configured name.
type Result struct {
	PersonFound bool       `json:"personFound"`
	Shifts      []Proposed `json:"shifts"`
	Warnings    []string   `json:"warnings"`
}

// Proposed is one proposed shift: a code on a Date. Code is nil when the cell can't be a code
// (such as "A/L"); RawCode then holds the cell's text for the user to resolve.
type Proposed struct {
	Date      string  `json:"date"`
	Code      *string `json:"code"`
	RawCode   string  `json:"rawCode"`
	Uncertain bool    `json:"uncertain"`
}

// Validate keeps the proposed shifts with a real YYYY-MM-DD date and a valid code (or a null
// code with the cell's text), and the first reading of each date. Every entry it drops becomes
// a warning. Shifts and Warnings are never nil, so they encode as JSON arrays.
func Validate(r Result) Result {
	out := Result{PersonFound: r.PersonFound, Shifts: []Proposed{}, Warnings: []string{}}
	for _, w := range r.Warnings {
		if w = strings.TrimSpace(w); w != "" {
			out.Warnings = append(out.Warnings, w)
		}
	}
	seen := map[string]bool{}
	for _, p := range r.Shifts {
		p.Date = strings.TrimSpace(p.Date)
		p.RawCode = strings.TrimSpace(p.RawCode)
		if d, err := time.Parse(time.DateOnly, p.Date); err != nil || d.Format(time.DateOnly) != p.Date {
			out.Warnings = append(out.Warnings, fmt.Sprintf("Skipped %s: %q is not a valid date", describe(p), p.Date))
			continue
		}
		if p.Code != nil {
			code := strings.ToUpper(strings.TrimSpace(*p.Code))
			if !store.ValidCode(code) {
				out.Warnings = append(out.Warnings, fmt.Sprintf("Skipped %s: %q is not a shift code", p.Date, *p.Code))
				continue
			}
			p.Code = &code
		} else if p.RawCode == "" {
			out.Warnings = append(out.Warnings, fmt.Sprintf("Skipped %s: no code was read", p.Date))
			continue
		}
		if seen[p.Date] {
			out.Warnings = append(out.Warnings, fmt.Sprintf("Skipped a second reading for %s: kept the first", p.Date))
			continue
		}
		seen[p.Date] = true
		out.Shifts = append(out.Shifts, p)
	}
	return out
}

// describe names an entry whose date is unusable by the cell it was read from.
func describe(p Proposed) string {
	switch {
	case p.Code != nil:
		return fmt.Sprintf("code %q", *p.Code)
	case p.RawCode != "":
		return fmt.Sprintf("cell %q", p.RawCode)
	default:
		return "an entry"
	}
}
