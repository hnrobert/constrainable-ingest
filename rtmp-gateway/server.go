// OBS-facing connection handler: account auth on a SINGLE URL, then a
// message-level relay to SRS. Auth logic ports the proven Python responder
// (/tmp/rtmp_authmod.py) byte-for-byte; the relay is the new part.
//
// SINGLE-URL DESIGN (rtmp://host/live for everything), shaped by three verified
// facts about OBS' vendored librtmp: (1) clients never volunteer credentials in
// connect — the dance can only be triggered by an _error answering a
// still-pending connect; (2) a client answers the challenge ONLY when BOTH
// username and password are configured (else it fails outright — no empty-user
// fallback, unlike rtmpdump); (3) the stream key naming the event only arrives
// at publish. So EVERYONE keeps "Use authentication" ON in OBS (auth events:
// real account credentials; no-auth events: anything, e.g. live/live), and:
//
//   conn 1 (plain connect)       → _error "authmod=adobe&code=403 need auth"
//   conn 2 ?authmod=adobe&user=U → _error "?reason=needauth&salt=S&opaque=O"
//   conn 3 ?...&response=R       → verify via app → _result EITHER WAY (graceful):
//                                  match → authed=true + authedUser; miss/unknown
//                                  → authed=false, connection still accepted
//
// Enforcement at PUBLISH (the only point the stream key — hence the event — is
// known): the gateway asks the app (GET /policy) whether the key's event
// requires account auth; unauthenticated pushes are rejected, and an authed
// publisher must publish under their OWN account email (no impersonation).
package main

import (
	"log"
	"net"
	"strings"
)

func handleOBS(conn net.Conn, app *appClient) {
	remote := conn.RemoteAddr().String()
	log.Printf("=== connection from %s ===", remote)

	if err := serverHandshake(conn); err != nil {
		log.Printf("%s handshake: %v", remote, err)
		return
	}
	cw := newChunkWriter(conn)
	cr := newChunkReader(conn)
	_ = cw.WriteMessage(&Message{Type: 1, CSID: 2, Payload: putBe4(4096)}) // our chunk size

	sawConnect := false
	authed := false  // true only after a successful authmod verify (stage 3)
	authedUser := "" // the email that was verified (must match the stream name)
	var up *upstream
	bytesIn := 0 // total payload bytes received from OBS (for acknowledgements)
	lastAck := 0
	for {
		msg, err := cr.ReadMessage()
		if err != nil {
			log.Printf("%s read end: %v", remote, err)
			break
		}

		// RTMP flow control: ack every advertised window (2.5MB). Without this,
		// librtmp stops sending once a full window goes unacknowledged — the
		// send buffer fills, media stalls, and stopping the stream hangs while
		// OBS drains it.
		bytesIn += len(msg.Payload)
		if bytesIn-lastAck >= 2500000 {
			lastAck = bytesIn
			_ = cw.WriteMessage(&Message{Type: 3, CSID: 2, Payload: putBe4(uint32(bytesIn))})
		}

		switch msg.Type {
		case 1: // SetChunkSize from OBS
			cr.chunkSize = int(be32(msg.Payload))

		case 8, 9, 18: // audio / video / script data → forward to SRS
			if up != nil {
				if err := up.writeFrame(msg); err != nil {
					// Upstream is gone — tear the OBS connection down too,
					// immediately. Keeping it half-alive leaves OBS showing
					// "live" while frames vanish, and makes Stop hang.
					log.Printf("%s upstream write failed: %v — closing OBS connection", remote, err)
					up.close()
					conn.Close()
					return
				}
			}

		case 20, 17: // AMF0 / AMF3 command
			vals := amfDecodeAll(msg.Payload)
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
				if sawConnect { // only the first connect drives the auth decision
					continue
				}
				sawConnect = true
				appField := appFromConnect(vals)
				qs := parseApp(appField)

				if _, ok := qs["response"]; ok {
					// ---- STAGE 3: verify GRACEFULLY. A failed/unknown verification
					// still accepts the connection (authed=false) — real OBS
					// cannot re-authenticate mid-session, so rejection happens at
					// PUBLISH via the per-event policy, where the stream key
					// finally identifies the event. ----
					user := qs["user"]
					allow := app.verify(user, qs["opaque"], qs["challenge"], qs["response"])
					if allow {
						authed = true
						authedUser = user
					}
					sendConnectResult(cw, txn)
					log.Printf("%s [stage3] user=%s verify=%v (accepted; authed=%v)", remote, user, allow, allow)
					if !allow {
						log.Printf("%s --> connect success (UNVERIFIED credentials — auth-required events will reject at publish)", remote)
					} else {
						log.Printf("%s --> connect success (authed as %s)", remote, user)
					}

				} else if _, ok := qs["authmod"]; ok {
					user := qs["user"]
					if user == "" {
						// ---- EMPTY USER: plain rtmpdump clients (not OBS — it
						// never answers the challenge without credentials) may
						// reconnect like this. Accept openly; auth-requiring
						// events are still rejected at publish via policy. ----
						sendConnectResult(cw, txn)
						log.Printf("%s --> connect success (no credentials, open)", remote)
					} else {
						// ---- STAGE 2: send the salt + opaque challenge ----
						salt := app.salt(user) // real salt, or random if unknown
						opaque := randHex(16)
						desc := "?reason=needauth&authmod=adobe&user=" + user + "&salt=" + salt + "&opaque=" + opaque
						_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdError(txn, desc)})
						log.Printf("%s [stage2] user=%s sent salt challenge", remote, user)
						return // close; OBS reconnects for stage 3
					}

				} else {
					// ---- STAGE 1: fresh connect → demand authmod ----
					_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdError(txn, "authmod=adobe&code=403 need auth")})
					log.Printf("%s [stage1] demanded authmod=adobe", remote)
					return
				}

			case "createStream":
				_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdCreateStreamResult(txn, 1)})

			case "publish":
				name := ""
				if len(vals) >= 4 {
					name, _ = vals[3].(string)
				}
				// The OBS stream key is now the publish key ALONE (no email
				// prefix). The gateway derives the stream NAME and rewrites the
				// publish to SRS as "<name>?token=<key>", so SRS' on_publish and
				// session attribution are unchanged:
				//   - authed connection      → the authenticated user's email
				//   - credless connection    → a stable name from the client IP
				//   - explicit <name>?token= → honored (still impersonation-checked
				//     on auth events)
				// Non-publish-key tokens (per-student keys, per-event publish
				// tokens) are relayed VERBATIM — SRS handles those paths itself.
				explicit := name
				if i := strings.Index(name, "?"); i >= 0 {
					explicit = name[:i]
				}
				token := parseApp(name)["token"]
				if token == "" && explicit != "" {
					token = explicit // bare publish-key form
					explicit = ""
				}

				if pol := app.policy(token); pol.PublishKey {
					final := explicit
					if pol.RequireAccountAuth {
						if !authed {
							log.Printf("%s publish '%s' rejected: event requires account auth", remote, name)
							_ = cw.WriteMessage(&Message{Type: 20, CSID: 5, StreamID: 1, Payload: cmdOnStatusError(
								"NetStream.Publish.BadName",
								"This event requires account authentication: enable 'Use authentication' in OBS and enter your account email and password.")})
							return
						}
						if explicit != "" && !strings.EqualFold(authedUser, explicit) {
							log.Printf("%s publish '%s' rejected: authed as %s, stream name is %s", remote, name, authedUser, explicit)
							_ = cw.WriteMessage(&Message{Type: 20, CSID: 5, StreamID: 1, Payload: cmdOnStatusError(
								"NetStream.Publish.BadName",
								"Stream name must be your own account email ("+authedUser+").")})
							return
						}
						if final == "" {
							final = authedUser
						}
					} else if final == "" {
						final = ipStreamName(remote)
					}
					if final == "" {
						final = "anon-" + randHex(4)
					}
					rewritten := final + "?token=" + token
					log.Printf("%s publish key '%s' → stream '%s'", remote, token, rewritten)
					name = rewritten
				}
				u, err := dialUpstream(cfgSRSAddr)
				if err != nil {
					log.Printf("%s upstream dial failed: %v", remote, err)
					return
				}
				if err := u.publish(name); err != nil {
					u.close()
					log.Printf("%s upstream publish failed: %v", remote, err)
					return
				}
				up = u
				// Drain SRS→gateway messages; when SRS closes the upstream (or we
				// do), close the OBS connection too — no zombie half-live state.
				go func() {
					u.drain(remote)
					log.Printf("%s upstream gone — closing OBS connection", remote)
					conn.Close()
				}()
				// StreamBegin(msid 1) — standard server signal that accompanies
				// Publish.Start.
				_ = cw.WriteMessage(&Message{Type: 4, CSID: 2, Payload: append([]byte{0, 0}, putBe4(1)...)})
				_ = cw.WriteMessage(&Message{Type: 20, CSID: 5, StreamID: 1, Payload: cmdOnStatusPublishStart()})
				log.Printf("%s publishing '%s' (authed=%v) -> %s", remote, name, authed, cfgSRSAddr)

			case "@setDataFrame": // onMetaData — forward to SRS as-is
				if up != nil {
					_ = up.writeFrame(msg)
				}

			case "releaseStream", "FCPublish", "FCUnpublish", "deleteStream", "_checkbw":
				_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdResultEmpty(txn)})

			default:
				log.Printf("%s cmd '%s' (txn %v) — unhandled", remote, cmd, txn)
			}

		default:
			// other protocol control (user control, ack, peer bw) — ignore
		}
	}
	if up != nil {
		up.close()
	}
}

// appFromConnect pulls the `app` string out of a connect command's props object
// (vals[2]). The app carries the auth query string, e.g.
// "live?authmod=adobe&user=robert&challenge=...&response=...&opaque=...".
func appFromConnect(vals []interface{}) string {
	if len(vals) < 3 {
		return ""
	}
	props, ok := vals[2].(map[string]interface{})
	if !ok {
		return ""
	}
	a, _ := props["app"].(string)
	return a
}

// parseApp splits an app field's query string WITHOUT url-decoding — base64
// values contain '+','/','=' which url-decoding would corrupt. Manual split keeps
// them verbatim (so the response compares byte-exact at the app).
func parseApp(app string) map[string]string {
	out := map[string]string{}
	q := app
	if i := strings.Index(app, "?"); i >= 0 {
		q = app[i+1:]
	}
	for _, pair := range strings.Split(q, "&") {
		if eq := strings.Index(pair, "="); eq >= 0 {
			out[pair[:eq]] = pair[eq+1:]
		}
	}
	return out
}

// ipStreamName derives a stable, publish-safe stream name from the client's
// remote address ("192.168.50.27:54321" → "ip-192.168.50.27"). Used for credless
// publishers (no account identity) so concurrent publishers stay unique per
// machine and dashboard session labels are still meaningful.
func ipStreamName(remote string) string {
	host, _, err := net.SplitHostPort(remote)
	if err != nil {
		host = remote
	}
	var b strings.Builder
	b.WriteString("ip-")
	for _, r := range host {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '.', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	return b.String()
}

// sendConnectResult writes the standard connect-success preamble: window ack
// size, peer bandwidth, StreamBegin, then _result Connect.Success.
func sendConnectResult(cw *chunkWriter, txn float64) {
	_ = cw.WriteMessage(&Message{Type: 5, CSID: 2, Payload: putBe4(2500000)})               // window ack size
	_ = cw.WriteMessage(&Message{Type: 6, CSID: 2, Payload: append(putBe4(2500000), 0x02)}) // peer bandwidth (dynamic)
	_ = cw.WriteMessage(&Message{Type: 4, CSID: 2, Payload: []byte{0, 0, 0, 0, 0, 0}})      // StreamBegin msid 0
	_ = cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdConnectOK(txn)})
}
