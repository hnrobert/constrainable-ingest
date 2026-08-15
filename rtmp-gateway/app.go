// HTTP client for the app's two internal RTMP-auth endpoints. Both are gated by
// the shared RTMP_AUTH_TOKEN header (set identically in the app's env). The
// verify endpoint is a password-equivalent oracle — never call it without the
// token, and the app never exposes it without one either.
package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type appClient struct {
	base  string
	token string
	hc    *http.Client
}

func newAppClient(base, token string) *appClient {
	return &appClient{
		base:  strings.TrimRight(base, "/"),
		token: token,
		hc:    &http.Client{Timeout: 5 * time.Second},
	}
}

// saltResult carries the stage-2 salt plus the kick-ban flag: a kicked user's
// OBS reconnect carries its email in the dance, so refusing HERE (fatal auth
// error from the caller) stops the reconnect loop at connect time.
type saltResult struct {
	Salt   string
	Banned bool
}

// salt returns the user's authmod salt (needed at stage 2 so librtmp can compute
// salted2 client-side) and whether the user's stream is kick-banned. On any
// error / unknown user it returns a random salt so the challenge is
// byte-identical and the stage-3 verify simply fails — the dance reveals
// nothing about whether the account exists.
func (a *appClient) salt(email string) saltResult {
	u := a.base + "/api/srs/rtmp-auth/salt?email=" + url.QueryEscape(email)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return saltResult{Salt: randHex(8)}
	}
	req.Header.Set("x-rtmp-auth", a.token)
	resp, err := a.hc.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		return saltResult{Salt: randHex(8)}
	}
	defer resp.Body.Close()
	var body struct {
		Salt   string `json:"salt"`
		Banned bool   `json:"banned"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body.Salt == "" {
		return saltResult{Salt: randHex(8)}
	}
	return saltResult{Salt: body.Salt, Banned: body.Banned}
}

// verifyResult distinguishes a WRONG PASSWORD on a real account (fatal) from
// an UNKNOWN USERNAME (placeholder credentials — tolerated so no-auth events
// keep working with any non-empty login).
type verifyResult struct {
	Allow bool
	Known bool
}

// verify asks the app to check the Adobe authmod response (stage 3). Fails
// closed (Allow=false, Known=false) on any error so a misbehaving app never
// authenticates anyone.
func (a *appClient) verify(email, opaque, challenge, response string) verifyResult {
	reqBody := struct {
		Email     string `json:"email"`
		Opaque    string `json:"opaque"`
		Challenge string `json:"challenge"`
		Response  string `json:"response"`
	}{email, opaque, challenge, response}
	raw, _ := json.Marshal(reqBody)
	req, err := http.NewRequest(http.MethodPost, a.base+"/api/srs/rtmp-auth/verify", strings.NewReader(string(raw)))
	if err != nil {
		return verifyResult{}
	}
	req.Header.Set("x-rtmp-auth", a.token)
	req.Header.Set("content-type", "application/json")
	resp, err := a.hc.Do(req)
	if err != nil {
		return verifyResult{}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return verifyResult{}
	}
	var out struct {
		Allow bool `json:"allow"`
		Known bool `json:"known"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return verifyResult{}
	}
	return verifyResult{Allow: out.Allow, Known: out.Known}
}

// policyResult is the app's answer for one stream-key token.
type policyResult struct {
	// PublishKey: the token is an event publish key (vs a per-student key or
	// per-event token, which the gateway must relay verbatim).
	PublishKey bool `json:"publishKey"`
	// RequireAccountAuth: the publish-key's event requires account auth — a
	// connection that skipped the authmod dance may not publish it.
	RequireAccountAuth bool `json:"requireAccountAuth"`
	// WindowOpen: the event is inside its scheduled window. When closed, the
	// gateway rejects the publish with NetStream.Publish.BadName, which OBS
	// treats as a terminal invalid-stream (it stops instead of retry-looping).
	WindowOpen bool `json:"windowOpen"`
	// Banned: this stream name was recently kicked by an admin — reject the
	// automatic reconnect the same terminal way so a kick actually sticks.
	Banned bool `json:"banned"`
}

// policy asks the app how to treat a publish token. Called at PUBLISH time —
// the earliest moment the stream key (hence the event) is known. Fails open
// (zero value): SRS' own on_publish hook still validates the key against the
// same app, so an app outage already blocks publishing there.
func (a *appClient) policy(token, stream string) policyResult {
	if token == "" {
		return policyResult{}
	}
	u := a.base + "/api/srs/rtmp-auth/policy?token=" + url.QueryEscape(token) +
		"&stream=" + url.QueryEscape(stream)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return policyResult{}
	}
	req.Header.Set("x-rtmp-auth", a.token)
	resp, err := a.hc.Do(req)
	if err != nil {
		return policyResult{}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return policyResult{}
	}
	var out policyResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return policyResult{}
	}
	return out
}

// randHex is a query-safe random string (hex has no '&', '=', '+', '/').
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "0000000000000000" // degenerate fallback
	}
	return hex.EncodeToString(b)
}
