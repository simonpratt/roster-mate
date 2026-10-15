package extract

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

// Claude extracts shifts with one Anthropic Messages call. The answer is constrained by
// structured outputs to the Result schema, then checked by Validate.
type Claude struct {
	client anthropic.Client
	model  string
	name   string
	log    *slog.Logger
	// Now gives today's date for the prompt; time.Now, in the server's TZ, by default.
	Now func() time.Time
}

// NewClaude returns an Extractor that reads name's shifts with model. opts are extra client
// options (tests point the client at a fake server with option.WithBaseURL).
func NewClaude(apiKey, model, name string, log *slog.Logger, opts ...option.RequestOption) *Claude {
	opts = append([]option.RequestOption{
		option.WithAPIKey(apiKey),
		// One retry, for an overloaded (529) or otherwise transient failure.
		option.WithMaxRetries(1),
	}, opts...)
	return &Claude{client: anthropic.NewClient(opts...), model: model, name: name, log: log, Now: time.Now}
}

// Extract sends the image and returns the validated result. Its errors are short and safe
// to show the user: they never carry the API key or the upstream response body.
func (c *Claude) Extract(ctx context.Context, img []byte, mediaType string) (Result, error) {
	start := time.Now()
	msg, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     c.model,
		MaxTokens: 16000,
		System:    []anthropic.TextBlockParam{{Text: BuildPrompt(c.name, c.Now())}},
		Messages: []anthropic.MessageParam{anthropic.NewUserMessage(
			anthropic.NewImageBlockBase64(mediaType, base64.StdEncoding.EncodeToString(img)),
			anthropic.NewTextBlock(fmt.Sprintf("Read %s's shifts from this roster.", c.name)),
		)},
		OutputConfig: anthropic.OutputConfigParam{Format: anthropic.JSONOutputFormatParam{Schema: schema}},
	})
	if err != nil {
		c.log.Error("extract", "model", c.model, "duration", time.Since(start), "err", err)
		return Result{}, upstreamError(ctx, err)
	}
	c.log.Info("extract", "model", c.model, "duration", time.Since(start),
		"inputTokens", msg.Usage.InputTokens, "outputTokens", msg.Usage.OutputTokens,
		"stopReason", msg.StopReason)

	switch msg.StopReason {
	case anthropic.StopReasonRefusal:
		return Result{}, errors.New("the model declined to read this image")
	case anthropic.StopReasonMaxTokens:
		return Result{}, errors.New("the answer was cut off")
	}
	var text strings.Builder
	for _, block := range msg.Content {
		if t, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(t.Text)
		}
	}
	var r Result
	if err := json.Unmarshal([]byte(text.String()), &r); err != nil {
		c.log.Error("extract: unreadable answer", "err", err)
		return Result{}, errors.New("the answer was not valid JSON")
	}
	return Validate(r), nil
}

func upstreamError(ctx context.Context, err error) error {
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
		return errors.New("timed out")
	}
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		return fmt.Errorf("the Anthropic API returned %d", apiErr.StatusCode)
	}
	return errors.New("could not reach the Anthropic API")
}
