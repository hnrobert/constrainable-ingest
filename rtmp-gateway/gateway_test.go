package main

// End-to-end auth test: a fake librtmp client performs the 3-connection Adobe
// authmod dance against the gateway, which calls a mock app exposing the same
// salt/verify contract as the real /api/srs/rtmp-auth/* endpoints. This proves
// the full auth path (handshake → stage 1/2/3 → verify) without OBS.

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func md5raw(s string) []byte { h := md5.Sum([]byte(s)); return h[:] }
func b64(b []byte) string    { return base64.StdEncoding.EncodeToString(b) }

func randB64(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

// startGateway runs the OBS-facing handler on an ephemeral port; no SRS needed
// for auth-only exercises (the relay is only reached after a successful publish).
func startGateway(t *testing.T, appBase, token string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	app := newAppClient(appBase, token)
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer func() { _ = recover(); _ = c.Close() }()
				handleOBS(c, app)
			}()
		}
	}()
	return ln.Addr().String()
}

// openClient dials the gateway, handshakes, and advertises a chunk size (like
// OBS does) so the gateway reads our single-chunk connect correctly.
func openClient(t *testing.T, addr string) (net.Conn, *chunkWriter, *chunkReader) {
	t.Helper()
	c, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	if err := clientHandshake(c); err != nil {
		t.Fatal(err)
	}
	cw := newChunkWriter(c)
	cr := newChunkReader(c)
	_ = cw.WriteMessage(&Message{Type: 1, CSID: 2, Payload: putBe4(4096)})
	return c, cw, cr
}

func sendConnect(cw *chunkWriter, app string) {
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdConnect(app, "rtmp://test/live")})
}

// cmdField reads the gateway's next command and returns a combined string of the
// info object's description + code, so assertions can match either.
func cmdField(cr *chunkReader) string {
	for {
		m, err := cr.ReadMessage()
		if err != nil {
			return "ERR:" + err.Error()
		}
		if m.Type == 1 {
			cr.chunkSize = int(be32(m.Payload))
			continue
		}
		if m.Type != 20 && m.Type != 17 {
			continue
		}
		var parts []string
		for _, v := range amfDecodeAll(m.Payload) {
			if o, ok := v.(map[string]interface{}); ok {
				if d, _ := o["description"].(string); d != "" {
					parts = append(parts, d)
				}
				if c, _ := o["code"].(string); c != "" {
					parts = append(parts, c)
				}
			}
		}
		return strings.Join(parts, " | ")
	}
}

// danceAuth mimics librtmp's full 3-connection authmod dance and returns the
// still-open stage-3 connection (already at Connect.Success). Non-fatal helper
// for callers that continue to createStream/publish on the same connection.
func danceAuth(t *testing.T, addr, user, password string) (net.Conn, *chunkWriter, *chunkReader) {
	t.Helper()

	// stage 1 — fresh connect → expect authmod demand
	c, cw, cr := openClient(t, addr)
	sendConnect(cw, "live")
	d1 := cmdField(cr)
	c.Close()
	if !strings.Contains(d1, "authmod=adobe") {
		t.Fatalf("stage1: expected authmod demand, got %q", d1)
	}

	// stage 2 — offer user → expect salt + opaque challenge
	c, cw, cr = openClient(t, addr)
	sendConnect(cw, "live?authmod=adobe&user="+user)
	d2 := cmdField(cr)
	c.Close()
	if !strings.Contains(d2, "reason=needauth") {
		t.Fatalf("stage2: expected needauth challenge, got %q", d2)
	}
	salt := kv(d2, "salt")
	opaque := kv(d2, "opaque")
	if salt == "" || opaque == "" {
		t.Fatalf("stage2: no salt/opaque in %q", d2)
	}

	// stage 3 — compute the librtmp response and reconnect
	challenge := randB64(8)
	salted2 := b64(md5raw(user + salt + password))
	response := b64(md5raw(salted2 + opaque + challenge))
	c, cw, cr = openClient(t, addr)
	sendConnect(cw, "live?authmod=adobe&user="+user+"&challenge="+challenge+"&response="+response+"&opaque="+opaque)
	if got := cmdField(cr); !strings.Contains(got, "NetConnection.Connect.Success") {
		c.Close()
		t.Fatalf("stage3: expected Connect.Success, got %q", got)
	}
	return c, cw, cr
}

// danceWrongPasswordOpen runs the full dance with a WRONG password; the gateway
// accepts stage 3 GRACEFULLY (unauthenticated), so the returned connection is
// open and usable up to publish.
func danceWrongPasswordOpen(t *testing.T, addr, user, wrongPassword string) (net.Conn, *chunkWriter, *chunkReader) {
	t.Helper()
	c, cw, cr := openClient(t, addr)
	sendConnect(cw, "live")
	cmdField(cr) // stage1 demand
	c.Close()

	c, cw, cr = openClient(t, addr)
	sendConnect(cw, "live?authmod=adobe&user="+user)
	d2 := cmdField(cr) // salt+opaque
	c.Close()
	salt := kv(d2, "salt")
	opaque := kv(d2, "opaque")
	challenge := randB64(8)
	salted2 := b64(md5raw(user + salt + wrongPassword))
	response := b64(md5raw(salted2 + opaque + challenge))
	c, cw, cr = openClient(t, addr)
	sendConnect(cw, "live?authmod=adobe&user="+user+"&challenge="+challenge+"&response="+response+"&opaque="+opaque)
	if got := cmdField(cr); !strings.Contains(got, "NetConnection.Connect.Success") {
		c.Close()
		t.Fatalf("wrong-pw stage3: expected graceful Connect.Success, got %q", got)
	}
	return c, cw, cr
}

// credlessConnect mimics a client with NO credentials configured: conn1 gets the
// authmod demand, conn2 answers with an EMPTY user and must be accepted openly
// (the single-URL escape hatch for requireAccountAuth-off events).
func credlessConnect(t *testing.T, addr string) (net.Conn, *chunkWriter, *chunkReader) {
	t.Helper()

	c, cw, cr := openClient(t, addr)
	sendConnect(cw, "live")
	d1 := cmdField(cr)
	c.Close()
	if !strings.Contains(d1, "authmod=adobe") {
		t.Fatalf("credless stage1: expected authmod demand, got %q", d1)
	}

	c2, cw2, cr2 := openClient(t, addr)
	sendConnect(cw2, "live?authmod=adobe&user=")
	if got := cmdField(cr2); !strings.Contains(got, "NetConnection.Connect.Success") {
		c2.Close()
		t.Fatalf("credless stage2: expected open Connect.Success, got %q", got)
	}
	return c2, cw2, cr2
}

// kv pulls key=value out of a query-like description without url-decoding.
func kv(q, key string) string {
	idx := strings.Index(q, key+"=")
	if idx < 0 {
		return ""
	}
	rest := q[idx+len(key)+1:]
	if i := strings.IndexByte(rest, '&'); i >= 0 {
		rest = rest[:i]
	}
	return rest
}

func TestAuthmodSuccessAndFailure(t *testing.T) {
	const (
		user     = "robert@example.com"
		password = "123456"
		salt     = "deadbeefsalt"
		token    = "test-token"
	)
	salted2 := b64(md5raw(user + salt + password)) // the stored verifier

	app := httptest.NewServer(mockAppMux(token, "", "", user, salt, salted2))
	defer app.Close()
	addr := startGateway(t, app.URL, token)

	// right password: the full dance reaches Connect.Success (authed)
	c, _, cr := danceAuth(t, addr, user, password)
	defer c.Close()
	_ = cr
	// wrong password: stage 3 is GRACEFUL — connect still succeeds (the
	// rejection happens later, at publish, for auth-requiring events)
	c2, cw2, cr2 := openClient(t, addr)
	defer c2.Close()
	_ = cw2
	if got := danceWrongPassword(t, addr, user, "wrongpw", salt); !strings.Contains(got, "NetConnection.Connect.Success") {
		t.Fatalf("wrong password: expected GRACEFUL Connect.Success, got %q", got)
	}
	_ = cr2
}

// danceWrongPassword runs the dance with a WRONG password and returns the
// stage-3 command field (graceful: expect Connect.Success, unauthenticated).
func danceWrongPassword(t *testing.T, addr, user, wrongPassword, salt string) string {
	t.Helper()
	c, cw, cr := openClient(t, addr)
	sendConnect(cw, "live")
	cmdField(cr) // stage1 demand
	c.Close()

	c, cw, cr = openClient(t, addr)
	sendConnect(cw, "live?authmod=adobe&user="+user)
	d2 := cmdField(cr) // salt+opaque
	c.Close()
	opaque := kv(d2, "opaque")
	challenge := randB64(8)
	salted2 := b64(md5raw(user + salt + wrongPassword))
	response := b64(md5raw(salted2 + opaque + challenge))
	c, cw, cr = openClient(t, addr)
	defer c.Close()
	sendConnect(cw, "live?authmod=adobe&user="+user+"&challenge="+challenge+"&response="+response+"&opaque="+opaque)
	return cmdField(cr)
}

// mockAppMux exposes the gateway's app contract: salt + verify (one known user)
// and policy. authKey requires account auth; openKey doesn't; closedKey's event
// window is shut; anything else is an unknown token.
func mockAppMux(token, authKey, openKey, user, salt, salted2 string) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/srs/rtmp-auth/salt", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-rtmp-auth") != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Query().Get("email") == user {
			_, _ = io.WriteString(w, `{"salt":"`+salt+`"}`)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	})
	mux.HandleFunc("/api/srs/rtmp-auth/verify", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-rtmp-auth") != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		b, _ := io.ReadAll(r.Body)
		opaque := between(string(b), `"opaque":"`, `"`)
		challenge := between(string(b), `"challenge":"`, `"`)
		response := between(string(b), `"response":"`, `"`)
		expect := b64(md5raw(salted2 + opaque + challenge))
		_, _ = io.WriteString(w, `{"allow":`+b2s(response == expect)+`}`)
	})
	mux.HandleFunc("/api/srs/rtmp-auth/policy", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-rtmp-auth") != token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		tok := r.URL.Query().Get("token")
		const closedKey = "closedkey1" // publish key whose event window is shut
		isKey := (tok == authKey && authKey != "") || (tok == openKey && openKey != "") || tok == closedKey
		require := isKey && tok == authKey
		open := tok != closedKey
		_, _ = io.WriteString(w, `{"publishKey":`+b2s(isKey)+`,"requireAccountAuth":`+b2s(require)+`,"windowOpen":`+b2s(open)+`}`)
	})
	return mux
}

// A client with NO credentials passes the challenge via the empty-user escape
// hatch (stage1 demand → stage2 empty user → open Connect.Success) and can then
// createStream normally.
func TestCredlessClientPassesThrough(t *testing.T) {
	const token = "test-token"
	app := httptest.NewServer(mockAppMux(token, "", "", "u@example.com", "s", "v"))
	defer app.Close()
	addr := startGateway(t, app.URL, token)

	c, cw, cr := credlessConnect(t, addr)
	defer c.Close()
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdCreateStream()})
	if got := nextCmdName(cr); got != "_result" {
		t.Fatalf("credless createStream: expected _result, got %q", got)
	}
}

// nextCmdName reads until the next AMF command and returns its method name.
func nextCmdName(cr *chunkReader) string {
	for {
		m, err := cr.ReadMessage()
		if err != nil {
			return "ERR:" + err.Error()
		}
		if m.Type != 20 && m.Type != 17 {
			continue
		}
		vals := amfDecodeAll(m.Payload)
		if len(vals) > 0 {
			if s, ok := vals[0].(string); ok {
				return s
			}
		}
	}
}

// fakeSRS is a minimal SRS publisher endpoint: handshakes server-side, answers
// connect/createStream, records the publish stream name, and acknowledges with
// Publish.Start so the gateway's upstream path completes.
func fakeSRS(t *testing.T, names chan<- string) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer func() { _ = recover(); _ = c.Close() }()
				if err := serverHandshake(c); err != nil {
					return
				}
				cw := newChunkWriter(c)
				cr := newChunkReader(c)
				// Announce our chunk size like real SRS does — without this the
				// gateway's reader stays at its 128-byte default and misframes
				// our larger command replies.
				_ = cw.WriteMessage(&Message{Type: 1, CSID: 2, Payload: putBe4(4096)})
				for {
					m, err := cr.ReadMessage()
					if err != nil {
						return
					}
					if m.Type == 1 {
						cr.chunkSize = int(be32(m.Payload))
						continue
					}
					if m.Type != 20 && m.Type != 17 {
						continue
					}
					vals := amfDecodeAll(m.Payload)
					if len(vals) == 0 {
						continue
					}
					cmd, _ := vals[0].(string)
					txn := 0.0
					if len(vals) >= 2 {
						txn, _ = vals[1].(float64)
					}
					switch cmd {
					case "connect":
						_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdConnectOK(txn)})
					case "createStream":
						_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdCreateStreamResult(txn, 1)})
					case "publish":
						if len(vals) >= 4 {
							n, _ := vals[3].(string)
							select {
							case names <- n:
							default:
							}
						}
						_ = cw.WriteMessage(&Message{Type: 20, CSID: 5, StreamID: 1, Payload: cmdOnStatusPublishStart()})
						return
					}
				}
			}()
		}
	}()
	return ln.Addr().String()
}

// expectName waits for the next upstream publish name and asserts it.
func expectName(t *testing.T, ch <-chan string, want string) {
	t.Helper()
	select {
	case got := <-ch:
		if got != want {
			t.Fatalf("upstream publish name: want %q, got %q", want, got)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("upstream publish never arrived (wanted %q)", want)
	}
}

// Publish-time behavior: per-event enforcement + stream-name derivation now that
// the OBS stream key is the publish key ALONE (no email prefix).
func TestPublishPolicyEnforcement(t *testing.T) {
	const (
		token     = "test-token"
		authKey   = "authkey123"
		openKey   = "openkey123"
		closedKey = "closedkey1"
		password  = "123456"
		salt      = "deadbeefsalt"
		user      = "robert@example.com"
	)
	salted2 := b64(md5raw(user + salt + password))
	app := httptest.NewServer(mockAppMux(token, authKey, openKey, user, salt, salted2))
	defer app.Close()
	addr := startGateway(t, app.URL, token)

	names := make(chan string, 8)
	oldSRS := cfgSRSAddr
	cfgSRSAddr = fakeSRS(t, names)
	defer func() { cfgSRSAddr = oldSRS }()

	// 1) credless connection + bare auth-requiring key → rejected
	c, cw, cr := credlessConnect(t, addr)
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish(authKey)})
	if got := cmdField(cr); !strings.Contains(got, "NetStream.Publish.BadName") {
		c.Close()
		t.Fatalf("auth key, credless conn: expected BadName rejection, got %q", got)
	}
	c.Close()

	// 1c) window-closed key (even AUTHED) → BadName "window closed" — OBS stops
	// instead of retry-looping
	c, cw, cr = danceAuth(t, addr, user, password)
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish("closedkey1")})
	if got := cmdField(cr); !strings.Contains(got, "streaming window is closed") {
		c.Close()
		t.Fatalf("closed-window key: expected window-closed BadName, got %q", got)
	}
	c.Close()
	_ = cr

	// 1b) WRONG-password dance (gracefully accepted, unauthed) + auth key →
	// still rejected at publish — the policy is the enforcement point
	c, cw, cr = danceWrongPasswordOpen(t, addr, user, "wrongpw")
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish(authKey)})
	if got := cmdField(cr); !strings.Contains(got, "NetStream.Publish.BadName") {
		c.Close()
		t.Fatalf("auth key, wrong-pw conn: expected BadName rejection, got %q", got)
	}
	c.Close()

	// 2) authed publisher + bare auth key → upstream name = the authed email
	c, cw, cr = danceAuth(t, addr, user, password)
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish(authKey)})
	expectName(t, names, user+"?token="+authKey)
	c.Close()

	// 3) authed publisher under ANOTHER user's explicit name → rejected
	c, cw, cr = danceAuth(t, addr, user, password)
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish("victim@example.com?token=" + authKey)})
	if got := cmdField(cr); !strings.Contains(got, "NetStream.Publish.BadName") {
		c.Close()
		t.Fatalf("impersonation: expected BadName rejection, got %q", got)
	}
	c.Close()

	// 4) credless connection + bare no-auth key → upstream name from client IP
	c, cw, cr = credlessConnect(t, addr)
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish(openKey)})
	expectName(t, names, "ip-127.0.0.1?token="+openKey)
	c.Close()

	// 5) credless connection + explicit name on a no-auth key → honored verbatim
	c, cw, cr = credlessConnect(t, addr)
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish("alice?token=" + openKey)})
	expectName(t, names, "alice?token="+openKey)
	c.Close()

	// 6) unknown token (per-student key) → relayed VERBATIM, no rewriting
	c, cw, cr = credlessConnect(t, addr)
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, StreamID: 1, Payload: cmdPublish("studentkey0001")})
	expectName(t, names, "studentkey0001")
	c.Close()
	_ = cr
}

func between(s, a, b string) string {
	i := strings.Index(s, a)
	if i < 0 {
		return ""
	}
	s = s[i+len(a):]
	if j := strings.Index(s, b); j >= 0 {
		return s[:j]
	}
	return s
}

func b2s(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
