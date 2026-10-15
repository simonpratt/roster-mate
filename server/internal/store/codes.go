package store

import "regexp"

// StandardCode is one of the five shift codes the app knows the meaning of. Keep these in step
// with web/src/shifts/codes.ts.
type StandardCode struct {
	Code  string
	Label string
}

// StandardCodes are D, E, L, N and X, in that order.
var StandardCodes = []StandardCode{
	{"D", "Day"},
	{"E", "Early"},
	{"L", "Late"},
	{"N", "Night"},
	{"X", "Day off"},
}

var codePattern = regexp.MustCompile(`^[A-Z]{1,2}$`)

// ValidCode reports whether s is a shift code: one or two uppercase letters. A valid code that
// is not a standard code is an Other code.
func ValidCode(s string) bool { return codePattern.MatchString(s) }

// IsStandardCode reports whether s is one of the standard codes.
func IsStandardCode(s string) bool {
	for _, c := range StandardCodes {
		if c.Code == s {
			return true
		}
	}
	return false
}
