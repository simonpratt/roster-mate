package api

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"time"

	"github.com/simonpratt/roster-mate/server/internal/extract"
)

const (
	maxImage       = 5 << 20
	maxExtractBody = maxImage + 1<<20 // room for the multipart framing around the image
	extractTimeout = 90 * time.Second
)

var imageTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// extractShifts reads the multipart field "image" (JPEG, PNG or WebP, at most 5 MB) and
// returns the shifts ex proposes from it. Nothing is stored, the image included.
func extractShifts(ex extract.Extractor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		img, status, msg := readImage(w, r)
		if status != 0 {
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}
		// The type is sniffed from the bytes, so a mislabelled upload can't reach the model.
		mediaType := http.DetectContentType(img)
		if !imageTypes[mediaType] {
			writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "image must be JPEG, PNG or WebP"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), extractTimeout)
		defer cancel()
		res, err := ex.Extract(ctx, img, mediaType)
		if err != nil {
			slog.Error("extract", "err", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "extraction failed: " + err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}

// readImage returns the bytes of the "image" part, or a non-zero status with a message.
func readImage(w http.ResponseWriter, r *http.Request) ([]byte, int, string) {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "multipart/form-data" {
		return nil, http.StatusUnsupportedMediaType, "send multipart/form-data with an image field"
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxExtractBody)
	mr, err := r.MultipartReader()
	if err != nil {
		return nil, http.StatusBadRequest, "bad request"
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			return nil, http.StatusBadRequest, "missing image field"
		}
		if err != nil {
			status, msg := readStatus(err)
			return nil, status, msg
		}
		if part.FormName() != "image" {
			continue
		}
		img, err := io.ReadAll(io.LimitReader(part, maxImage+1))
		if err != nil {
			status, msg := readStatus(err)
			return nil, status, msg
		}
		if len(img) > maxImage {
			return nil, http.StatusRequestEntityTooLarge, tooLarge
		}
		if len(img) == 0 {
			return nil, http.StatusBadRequest, "image is empty"
		}
		return img, 0, ""
	}
}

const tooLarge = "image must be at most 5 MB"

func readStatus(err error) (int, string) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return http.StatusRequestEntityTooLarge, tooLarge
	}
	return http.StatusBadRequest, "bad request"
}
