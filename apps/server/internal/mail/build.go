package mail

import (
	"fmt"
	"strconv"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/store"
)

// chip is a code's light chip colours: fill, text and 1 px outline.
type chip struct{ bg, fg, line string }

// chips are the email's light colours for the standard codes (ux-spec §6.8), beside the codes
// in store/codes.go. Every standard code has an entry; any other valid code uses otherChip.
var chips = map[string]chip{
	"D": {"#FEF3C7", "#8A4B00", "#FEF3C7"},
	"E": {"#E0F2FE", "#075985", "#E0F2FE"},
	"L": {"#EDE9FE", "#5B21B6", "#EDE9FE"},
	"N": {"#E0E7FF", "#3730A3", "#E0E7FF"},
	"X": {"#FFFFFF", "#6B7280", "#D0D4DA"},
}

var (
	otherChip      = chip{"#ECFCCB", "#3F6212", "#ECFCCB"}
	unrosteredChip = chip{"#FFFFFF", "#9CA3AF", "#E3E6EA"}
)

const (
	ink        = "#16181D"
	muted      = "#5B6270"
	dayOffFg   = "#6B7280"
	unrostered = "#9CA3AF"
	weekdayBg  = "#FFFFFF"
	weekendBg  = "#F8F9FA"
	rowLine    = "1px solid #EEF0F2"
	dateLayout = "2006-01-02"
)

// BuildRosterEmail builds the view for the whole weeks from first (a Monday) to last (a Sunday),
// both YYYY-MM-DD, from the shift codes by date. A date missing from shifts, or with "", is
// unrostered. today decides whether the subject names the year.
func BuildRosterEmail(first, last string, shifts map[string]string, today time.Time) RosterEmail {
	start, err1 := time.Parse(dateLayout, first)
	end, err2 := time.Parse(dateLayout, last)
	if err1 != nil || err2 != nil || end.Before(start) {
		return RosterEmail{}
	}

	labels := map[string]string{}
	for _, c := range store.StandardCodes {
		labels[c.Code] = c.Label
	}

	var weeks []Week
	working := 0
	for d, i := start, 0; !d.After(end); d, i = d.AddDate(0, 0, 1), i+1 {
		if i%7 == 0 {
			weeks = append(weeks, Week{Title: "Week of " + longDate(d)})
		}
		code := shifts[d.Format(dateLayout)]
		row := Row{Date: longDate(d), RowBg: weekdayBg, RowLine: rowLine}
		if wd := d.Weekday(); wd == time.Saturday || wd == time.Sunday {
			row.RowBg = weekendBg
		}
		if i%7 == 0 {
			row.RowLine = "0"
		}
		switch {
		case code == "":
			row.Code, row.Label = "–", "Not rostered"
			row.setChip(unrosteredChip)
			row.LabelFg, row.LabelWeight, row.DateFg = unrostered, "400", muted
		case code == "X":
			row.Code, row.Label = code, labels[code]
			row.setChip(chips[code])
			row.LabelFg, row.LabelWeight, row.DateFg = dayOffFg, "400", muted
		default:
			working++
			c, ok := chips[code]
			if !ok {
				c = otherChip
			}
			label, ok := labels[code]
			if !ok {
				label = code
			}
			row.Code, row.Label = code, label
			row.setChip(c)
			row.LabelFg, row.LabelWeight, row.DateFg = ink, "600", ink
		}
		w := &weeks[len(weeks)-1]
		w.Rows = append(w.Rows, row)
	}

	short := shortDate(start) + " – " + shortDate(end)
	if end.Year() != today.Year() {
		short += " " + strconv.Itoa(end.Year())
	}
	heading := longDate(start)
	if start.Year() != end.Year() {
		heading += " " + strconv.Itoa(start.Year())
	}
	heading += " – " + longDate(end) + " " + strconv.Itoa(end.Year())

	shiftWord := "working shifts"
	if working == 1 {
		shiftWord = "working shift"
	}
	return RosterEmail{
		Subject:   "New roster: " + short,
		Preheader: fmt.Sprintf("%d %s, %s", working, shiftWord, short),
		Range:     heading,
		Summary:   fmt.Sprintf("%d %s over %s.", working, shiftWord, weeksPhrase(len(weeks))),
		Weeks:     weeks,
	}
}

func (r *Row) setChip(c chip) { r.ChipBg, r.ChipFg, r.ChipLine = c.bg, c.fg, c.line }

// longDate is en-AU "Mon 26 Oct"; shortDate is "26 Oct".
func longDate(d time.Time) string  { return d.Format("Mon 2 Jan") }
func shortDate(d time.Time) string { return d.Format("2 Jan") }

var numberWords = []string{"", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"}

// weeksPhrase is "one week", "two weeks" … "ten weeks", then digits: "11 weeks".
func weeksPhrase(n int) string {
	word := strconv.Itoa(n)
	if n >= 1 && n < len(numberWords) {
		word = numberWords[n]
	}
	if n == 1 {
		return word + " week"
	}
	return word + " weeks"
}
