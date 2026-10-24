package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/simonpratt/roster-mate/apps/server/internal/auth"
	"github.com/simonpratt/roster-mate/apps/server/internal/extract"
)

type fakeExtractor struct {
	res       extract.Result
	err       error
	calls     int
	mediaType string
	img       []byte
	deadline  bool
}

func (f *fakeExtractor) Extract(ctx context.Context, img []byte, mediaType string) (extract.Result, error) {
	f.calls++
	f.img, f.mediaType = img, mediaType
	_, f.deadline = ctx.Deadline()
	return f.res, f.err
}

func newExtractServer(t *testing.T, ex extract.Extractor) string {
	t.Helper()
	a := auth.New("simon", "secret", []byte("0123456789abcdef0123456789abcdef"))
	srv := httptest.NewServer(NewRouter(http.NotFoundHandler(), a, newStore(t), ex, Options{}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// jpeg is a JPEG header padded to n bytes.
func jpeg(n int) []byte {
	b := make([]byte, n)
	copy(b, []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0})
	return b
}

// postImage uploads data as the multipart field "image" labelled contentType.
func postImage(t *testing.T, url string, c *http.Cookie, field, contentType string, data []byte) (*http.Response, string) {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="`+field+`"; filename="roster"`)
	h.Set("Content-Type", contentType)
	pw, err := mw.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	pw.Write(data)
	mw.Close()
	return do(t, "POST", url+"/api/extract", body.String(), c, "Content-Type", mw.FormDataContentType())
}

func TestExtractReturnsTheExtractorsResult(t *testing.T) {
	l, se := "L", "SE"
	fake := &fakeExtractor{res: extract.Result{
		PersonFound: true,
		Shifts: []extract.Proposed{
			{Date: "2026-11-03", Code: &l, RawCode: "L"},
			{Date: "2026-11-04", Code: &se, RawCode: "se", Uncertain: true},
			{Date: "2026-11-05", RawCode: "A/L"},
		},
		Warnings: []string{"Week of 10 Nov is partly obscured"},
	}}
	url := newExtractServer(t, fake)
	img := jpeg(1000)
	res, body := postImage(t, url, loginCookie(t, url), "image", "image/jpeg", img)
	if res.StatusCode != 200 {
		t.Fatalf("POST /api/extract = %d %q", res.StatusCode, body)
	}
	want := `{"personFound":true,"shifts":[` +
		`{"date":"2026-11-03","code":"L","rawCode":"L","uncertain":false},` +
		`{"date":"2026-11-04","code":"SE","rawCode":"se","uncertain":true},` +
		`{"date":"2026-11-05","code":null,"rawCode":"A/L","uncertain":false}],` +
		`"warnings":["Week of 10 Nov is partly obscured"]}`
	if strings.TrimSpace(body) != want {
		t.Errorf("body = %s\nwant   %s", body, want)
	}
	if fake.mediaType != "image/jpeg" || !bytes.Equal(fake.img, img) || !fake.deadline {
		t.Errorf("extractor got %s, %d bytes, deadline %v", fake.mediaType, len(fake.img), fake.deadline)
	}
}

func TestExtractRejections(t *testing.T) {
	cases := []struct {
		name        string
		field, ct   string
		data        []byte
		want        int
		errContains string
	}{
		{"6 MB image", "image", "image/jpeg", jpeg(6 << 20), 413, "5 MB"},
		{"just over 5 MB", "image", "image/jpeg", jpeg(5<<20 + 1), 413, "5 MB"},
		{"plain text", "image", "text/plain", []byte("Simon: D D N N X X"), 415, "JPEG, PNG or WebP"},
		{"text labelled as JPEG", "image", "image/jpeg", []byte("not really a picture"), 415, "JPEG, PNG or WebP"},
		{"no image field", "photo", "image/jpeg", jpeg(100), 400, "missing image"},
	}
	fake := &fakeExtractor{}
	url := newExtractServer(t, fake)
	c := loginCookie(t, url)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, body := postImage(t, url, c, tc.field, tc.ct, tc.data)
			if res.StatusCode != tc.want || !strings.Contains(body, tc.errContains) {
				t.Errorf("POST /api/extract = %d %q, want %d mentioning %q", res.StatusCode, body, tc.want, tc.errContains)
			}
		})
	}
	if fake.calls != 0 {
		t.Errorf("extractor called %d times for rejected uploads", fake.calls)
	}

	// Exactly 5 MB is accepted.
	res, body := postImage(t, url, c, "image", "image/jpeg", jpeg(5<<20))
	if res.StatusCode != 200 {
		t.Errorf("5 MB upload = %d %q, want 200", res.StatusCode, body)
	}
}

func TestExtractNotMultipartIs415(t *testing.T) {
	url := newExtractServer(t, &fakeExtractor{})
	res, body := do(t, "POST", url+"/api/extract", `{"image":"x"}`, loginCookie(t, url))
	if res.StatusCode != 415 {
		t.Errorf("JSON POST /api/extract = %d %q, want 415", res.StatusCode, body)
	}
}

func TestExtractNeedsSession(t *testing.T) {
	fake := &fakeExtractor{}
	url := newExtractServer(t, fake)
	res, body := postImage(t, url, nil, "image", "image/jpeg", jpeg(1000))
	if res.StatusCode != 401 || fake.calls != 0 {
		t.Errorf("POST /api/extract without a cookie = %d %q, extractor calls %d", res.StatusCode, body, fake.calls)
	}
}

func TestExtractorErrorIs502(t *testing.T) {
	url := newExtractServer(t, &fakeExtractor{err: errors.New("the Anthropic API returned 529")})
	res, body := postImage(t, url, loginCookie(t, url), "image", "image/png", []byte("\x89PNG\r\n\x1a\n0000"))
	var got map[string]string
	json.Unmarshal([]byte(body), &got)
	if res.StatusCode != 502 || got["error"] != "extraction failed: the Anthropic API returned 529" {
		t.Errorf("POST /api/extract = %d %q", res.StatusCode, body)
	}
}
