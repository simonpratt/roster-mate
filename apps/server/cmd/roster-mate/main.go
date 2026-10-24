// Command roster-mate runs the Roster Mate server: the JSON API and the embedded web app on one port.
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
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // TZ works on any base image, including ones without zoneinfo

	"github.com/anthropics/anthropic-sdk-go/option"

	"github.com/simonpratt/roster-mate/apps/server/internal/api"
	"github.com/simonpratt/roster-mate/apps/server/internal/auth"
	"github.com/simonpratt/roster-mate/apps/server/internal/config"
	"github.com/simonpratt/roster-mate/apps/server/internal/extract"
	"github.com/simonpratt/roster-mate/apps/server/internal/store"
	"github.com/simonpratt/roster-mate/apps/server/internal/web"
	client "github.com/simonpratt/roster-mate/apps/web"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Getenv, os.Stderr, nil))
}

// run starts the server and blocks until ctx is cancelled. It returns the process exit code.
// onListen, if set, is called with the bound address once the server is listening.
func run(ctx context.Context, getenv func(string) string, stderr io.Writer, onListen func(net.Addr)) int {
	log := slog.New(slog.NewTextHandler(stderr, nil))

	cfg, err := config.Load(getenv)
	if err != nil {
		fmt.Fprintf(stderr, "roster-mate: %v\n", err)
		return 1
	}

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		fmt.Fprintf(stderr, "roster-mate: %v\n", err)
		return 1
	}
	defer st.Close()

	a, err := newAuth(cfg, st)
	if err != nil {
		fmt.Fprintf(stderr, "roster-mate: %v\n", err)
		return 1
	}

	var opts []option.RequestOption
	if cfg.AnthropicBaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.AnthropicBaseURL))
	}
	ex := extract.NewClaude(cfg.AnthropicAPIKey, cfg.AnthropicModel, cfg.RosterName, log, opts...)
	handler := api.NewRouter(web.Handler(client.Dist()), a, st, ex, api.Options{Email: cfg.EmailEnabled()})
	if cfg.TestMode {
		log.Warn("test mode is on: POST /api/test/reset deletes every shift, shift change, event, babysitter, recipient and roster email send without a session; never set APP_TEST_MODE in production")
		handler = api.WithTestRoutes(handler, st)
	}
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	addr := net.JoinHostPort("", strconv.Itoa(cfg.Port))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(stderr, "roster-mate: listening on %s: %v\n", addr, err)
		return 1
	}
	email := "off"
	if cfg.EmailEnabled() {
		email = "on"
	}
	log.Info("listening", "addr", ln.Addr().String(), "dataDir", cfg.DataDir, "model", cfg.AnthropicModel, "email", email)
	if onListen != nil {
		onListen(ln.Addr())
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		fmt.Fprintf(stderr, "roster-mate: %v\n", err)
		return 1
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintf(stderr, "roster-mate: shutdown: %v\n", err)
		return 1
	}
	log.Info("stopped")
	return 0
}

// newAuth signs sessions with SESSION_SECRET, or else with the key kept in the database so
// sessions survive restarts.
func newAuth(cfg config.Config, st *store.Store) (*auth.Auth, error) {
	key := []byte(cfg.SessionSecret)
	if len(key) == 0 {
		var err error
		if key, err = st.SessionSecret(); err != nil {
			return nil, err
		}
	}
	return auth.New(cfg.Username, cfg.Password, key), nil
}
