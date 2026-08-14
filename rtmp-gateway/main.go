// rtmp-gateway: an RTMP front-proxy that authenticates OBS publishers with the
// website account (Adobe authmod challenge-response against the login password)
// and relays authenticated media to SRS. Account auth lives here; event auth
// (the ?token=<publishKey>) still happens at SRS' on_publish hook, unchanged.
//
// Pure Go stdlib — no external deps. See README.md for config + the auth model.
package main

import (
	"log"
	"net"
	"os"
)

var (
	cfgListen   = envOr("RTMP_LISTEN", ":1935")
	cfgSRSAddr  = envOr("SRS_ADDR", "localhost:1935")
	cfgAppBase  = envOr("APP_BASE", "http://localhost:31954")
	cfgAppToken = os.Getenv("RTMP_AUTH_TOKEN") // no default — must match the app's
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func main() {
	// CAPTURE=1 → diagnostic mode: dump OBS' connect object (no challenge). See
	// capture.go. Skips the normal gateway + token warning.
	if os.Getenv("CAPTURE") == "1" {
		runCapture(cfgListen)
		return
	}
	if cfgAppToken == "" {
		log.Println("WARNING: RTMP_AUTH_TOKEN is empty — the app will reject all salt/verify calls (auth will fail)")
	}
	ln, err := net.Listen("tcp", cfgListen)
	if err != nil {
		log.Fatalf("listen %s: %v", cfgListen, err)
	}
	app := newAppClient(cfgAppBase, cfgAppToken)
	log.Printf("rtmp-gateway on %s -> relay %s | app %s | single-URL authmod dance (empty-user = open) | per-event policy at publish",
		cfgListen, cfgSRSAddr, cfgAppBase)

	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("accept: %v", err)
			continue
		}
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("conn %s panic: %v", conn.RemoteAddr(), r)
				}
				_ = conn.Close()
			}()
			handleOBS(conn, app)
		}()
	}
}
