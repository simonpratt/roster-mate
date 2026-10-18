package main

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestRunServesHealthAndTheFakeThenStops(t *testing.T) {
	env := map[string]string{"FAKE_ANTHROPIC_ADDR": "127.0.0.1:0", "FAKE_ANTHROPIC_KEY": "k"}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addrc := make(chan net.Addr, 1)
	codec := make(chan int, 1)
	var stderr bytes.Buffer
	go func() {
		codec <- run(ctx, func(k string) string { return env[k] }, &stderr, func(a net.Addr) { addrc <- a })
	}()
	var base string
	select {
	case a := <-addrc:
		base = fmt.Sprintf("http://%s", a)
	case code := <-codec:
		t.Fatalf("run = %d before listening: %s", code, stderr.String())
	case <-time.After(5 * time.Second):
		t.Fatal("run didn't start listening")
	}
	c := &http.Client{Transport: &http.Transport{Proxy: nil}}

	res, err := c.Get(base + "/health")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Errorf("GET /health = %s", res.Status)
	}
	req, _ := http.NewRequest("POST", base+"/v1/messages", strings.NewReader(`{"messages":[]}`))
	req.Header.Set("x-api-key", "k")
	res, err = c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Errorf("POST /v1/messages = %s", res.Status)
	}

	cancel()
	select {
	case code := <-codec:
		if code != 0 {
			t.Errorf("run = %d after cancel: %s", code, stderr.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("run didn't stop")
	}
}
