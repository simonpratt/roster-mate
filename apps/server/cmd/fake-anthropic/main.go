// Command fake-anthropic serves the shared fake Anthropic Messages API (internal/extract/
// fakeanthropic) for the browser suite: point the server's ANTHROPIC_BASE_URL at it.
//
// FAKE_ANTHROPIC_ADDR is the listen address (default 127.0.0.1:18081) and FAKE_ANTHROPIC_KEY the
// only API key it accepts (default sk-ant-e2e). GET /health answers 200.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/simonpratt/roster-mate/apps/server/internal/extract/fakeanthropic"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Getenv, os.Stderr, nil))
}

// run serves the fake until ctx is cancelled and returns the exit code. onListen, if set, gets
// the bound address.
func run(ctx context.Context, getenv func(string) string, stderr io.Writer, onListen func(net.Addr)) int {
	log := slog.New(slog.NewTextHandler(stderr, nil))
	addr := getenv("FAKE_ANTHROPIC_ADDR")
	if addr == "" {
		addr = "127.0.0.1:18081"
	}
	key := getenv("FAKE_ANTHROPIC_KEY")
	if key == "" {
		key = "sk-ant-e2e"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"ok":true}`)
	})
	mux.Handle("/", fakeanthropic.New(key))
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(stderr, "fake-anthropic: listening on %s: %v\n", addr, err)
		return 1
	}
	log.Info("fake-anthropic listening", "addr", ln.Addr().String())
	if onListen != nil {
		onListen(ln.Addr())
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		fmt.Fprintf(stderr, "fake-anthropic: %v\n", err)
		return 1
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(stderr, "fake-anthropic: shutdown: %v\n", err)
		return 1
	}
	return 0
}
