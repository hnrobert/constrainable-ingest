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

// salt returns the user's authmod salt (needed at stage 2 so librtmp can compute
// salted2 client-side). On any error / unknown user it returns a random salt so
// the challenge is byte-identical and the stage-3 verify simply fails — the
// dance reveals nothing about whether the account exists.
func (a *appClient) salt(email string) string {
	u := a.base + "/api/srs/rtmp-auth/salt?email=" + url.QueryEscape(email)
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return randHex(8)
	}
	req.Header.Set("x-rtmp-auth", a.token)
	resp, err := a.hc.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		if resp != nil {
			resp.Body.Close()
		}
		return randHex(8)
	}
	defer resp.Body.Close()
	var body struct {
		Salt string `json:"salt"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil || body.Salt == "" {
		return randHex(8)
	}
	return body.Salt
}

// verify asks the app to check the Adobe authmod response (stage 3). Returns
// false on any error so a misbehaving app fails closed.
func (a *appClient) verify(email, opaque, challenge, response string) bool {
	reqBody := struct {
		Email     string `json:"email"`
		Opaque    string `json:"opaque"`
		Challenge string `json:"challenge"`
		Response  string `json:"response"`
	}{email, opaque, challenge, response}
	raw, _ := json.Marshal(reqBody)
	req, err := http.NewRequest(http.MethodPost, a.base+"/api/srs/rtmp-auth/verify", strings.NewReader(string(raw)))
	if err != nil {
		return false
	}
	req.Header.Set("x-rtmp-auth", a.token)
	req.Header.Set("content-type", "application/json")
	resp, err := a.hc.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var out struct {
		Allow bool `json:"allow"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return false
	}
	return out.Allow
}

// policyResult is the app's answer for one stream-key token.
type policyResult struct {
	// PublishKey: the token is an event publish key (vs a per-student key or
	// per-event token, which the gateway must relay verbatim).
	PublishKey bool `json:"publishKey"`
	// RequireAccountAuth: the publish-key's event requires account auth — a
	// connection that skipped the authmod dance may not publish it.
	RequireAccountAuth bool `json:"requireAccountAuth"`
}

// policy asks the app how to treat a publish token. Called at PUBLISH time —
// the earliest moment the stream key (hence the event) is known. Fails open
// (zero value): SRS' own on_publish hook still validates the key against the
// same app, so an app outage already blocks publishing there.
func (a *appClient) policy(token string) policyResult {
	if token == "" {
		return policyResult{}
	}
	u := a.base + "/api/srs/rtmp-auth/policy?token=" + url.QueryEscape(token)
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
