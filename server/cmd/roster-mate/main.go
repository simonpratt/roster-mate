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

	"github.com/simonpratt/roster-mate/server/internal/api"
	"github.com/simonpratt/roster-mate/server/internal/auth"
	"github.com/simonpratt/roster-mate/server/internal/config"
	"github.com/simonpratt/roster-mate/server/internal/extract"
	"github.com/simonpratt/roster-mate/server/internal/store"
	"github.com/simonpratt/roster-mate/server/internal/web"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	os.Exit(run(ctx, os.Getenv, os.Stderr))
}

// run starts the server and blocks until ctx is cancelled. It returns the process exit code.
func run(ctx context.Context, getenv func(string) string, stderr io.Writer) int {
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

	ex := extract.NewClaude(cfg.AnthropicAPIKey, cfg.AnthropicModel, cfg.RosterName, log)
	srv := &http.Server{
		Addr:              net.JoinHostPort("", strconv.Itoa(cfg.Port)),
		Handler:           api.NewRouter(web.Handler(web.Dist()), a, st, ex),
		ReadHeaderTimeout: 10 * time.Second,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("listening", "addr", srv.Addr, "dataDir", cfg.DataDir, "model", cfg.AnthropicModel)

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
