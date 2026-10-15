package extract

import (
	"fmt"
	"strings"
	"time"

	"github.com/simonpratt/roster-mate/server/internal/store"
)

// BuildPrompt returns the system prompt for reading name's shifts, with today (a local
// calendar date) for inferring missing years.
func BuildPrompt(name string, today time.Time) string {
	var codes strings.Builder
	for _, c := range store.StandardCodes {
		fmt.Fprintf(&codes, "- %s: %s\n", c.Code, c.Label)
	}
	return fmt.Sprintf(`You read one person's shifts from a photo of a work roster and return them as JSON.

The person is %q. Find the row (or column) for that name and read only that person's shifts. Ignore every other person's row. Names may be printed as surname first, abbreviated or in capitals; match the person sensibly. If the name is not on the roster, set personFound to false and return no shifts.

Today's date is %s (%s). When the roster leaves out the year, infer it from today: rosters are usually for the current or an upcoming period, so a month that has already passed this year most likely belongs to next year.

Every shift is one code on one date. Date each shift by the day it starts, as the roster prints it: a Night shift that runs past midnight belongs to the date it starts on, not the next day. Write dates as YYYY-MM-DD.

The standard codes are:
%s
Apply these rules to each cell in this order:
1. Synonyms first. Map OFF, RDO, "/", and a cell left blank but marked as a day off to X. Map AM to E. Map PM to L. Do this before rule 2, so AM and PM become E and L rather than Other codes.
2. Other codes. Any other cell of one or two letters is that code in uppercase, an Other code (for example "se" becomes SE). Do not guess a standard code for it.
3. Not a code. When a cell can't be a code (more than two letters, or anything other than letters, such as "A/L"), set code to null and put the cell's text in rawCode. Do not guess a code.

For every shift, put the cell's text as printed in rawCode. Set uncertain to true when a cell or its date is hard to read (blurred, cut off, handwritten or ambiguous). Leave out dates with no cell for this person. Put anything the user should know, such as part of the roster being obscured, in warnings as short sentences.`,
		name, today.Format(time.DateOnly), today.Format("Monday 2 January 2006"), codes.String())
}

// schema is the JSON schema the model's answer must match: Result in camelCase.
var schema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"personFound", "shifts", "warnings"},
	"properties": map[string]any{
		"personFound": map[string]any{
			"type":        "boolean",
			"description": "Whether the person's name is on the roster.",
		},
		"shifts": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"date", "code", "rawCode", "uncertain"},
				"properties": map[string]any{
					"date": map[string]any{
						"type":        "string",
						"description": "The date the shift starts, YYYY-MM-DD.",
					},
					"code": map[string]any{
						"type":        []string{"string", "null"},
						"description": "One or two uppercase letters, or null when the cell can't be a code.",
					},
					"rawCode": map[string]any{
						"type":        "string",
						"description": "The cell's text as printed.",
					},
					"uncertain": map[string]any{
						"type":        "boolean",
						"description": "True when the cell or its date is hard to read.",
					},
				},
			},
		},
		"warnings": map[string]any{
			"type":  "array",
			"items": map[string]any{"type": "string"},
		},
	},
}
