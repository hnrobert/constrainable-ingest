// Upstream = the gateway as an RTMP *publisher* client to SRS. After OBS is
// authenticated, the gateway opens this connection, runs connect → createStream
// → publish (replaying OBS' stream name verbatim so SRS' on_publish hook +
// authorizePublish do event auth unchanged), then forwards every audio/video/
// script frame OBS sends. A background drain goroutine reads+discards SRS' own
// messages so SRS' send buffer can't fill and block our writes.
package main

import (
	"log"
	"net"
)

type upstream struct {
	conn     net.Conn
	cw       *chunkWriter
	cr       *chunkReader
	streamID float64
}

// dialUpstream connects to SRS, handshakes, sets chunk size, connect()s and
// createStream()s. The publish happens later (once we know OBS' stream name).
func dialUpstream(addr string) (*upstream, error) {
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return nil, err
	}
	if err := clientHandshake(conn); err != nil {
		conn.Close()
		return nil, err
	}
	up := &upstream{conn: conn, cw: newChunkWriter(conn), cr: newChunkReader(conn)}

	// Announce our chunk size, then connect.
	if err := up.cw.WriteMessage(&Message{Type: 1, CSID: 2, Payload: putBe4(4096)}); err != nil {
		up.close()
		return nil, err
	}
	tcURL := "rtmp://" + addr + "/live"
	if err := up.cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdConnect("live", tcURL)}); err != nil {
		up.close()
		return nil, err
	}
	if _, err := up.readUntilCommand(); err != nil { // connect _result
		up.close()
		return nil, err
	}
	if err := up.cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdCreateStream()}); err != nil {
		up.close()
		return nil, err
	}
	vals, err := up.readUntilCommand() // createStream _result
	if err != nil {
		up.close()
		return nil, err
	}
	if len(vals) >= 4 {
		if sid, ok := vals[3].(float64); ok {
			up.streamID = sid
		}
	}
	if up.streamID == 0 {
		up.streamID = 1
	}
	return up, nil
}

// publish sends publish(streamName,"live") and waits for the first command back
// (typically onStatus NetStream.Publish.Start).
func (up *upstream) publish(name string) error {
	if err := up.cw.WriteMessage(&Message{Type: 20, CSID: 3, Payload: cmdPublish(name)}); err != nil {
		return err
	}
	if _, err := up.readUntilCommand(); err != nil {
		return err
	}
	return nil
}

// writeFrame forwards a media/script message to SRS on the upstream stream id.
func (up *upstream) writeFrame(m *Message) error {
	fwd := *m
	fwd.StreamID = uint32(up.streamID)
	return up.cw.WriteMessage(&fwd)
}

// drain reads and discards SRS→gateway messages (onStatus, ACKs, control) so
// SRS' send side never blocks. Run in its own goroutine after publish.
func (up *upstream) drain(remote string) {
	for {
		if _, err := up.cr.ReadMessage(); err != nil {
			log.Printf("%s upstream closed: %v", remote, err)
			return
		}
	}
}

func (up *upstream) close() { _ = up.conn.Close() }

// readUntilCommand skips control/set-chunk-size messages until an AMF command
// arrives, then returns its decoded values.
func (up *upstream) readUntilCommand() ([]interface{}, error) {
	for {
		msg, err := up.cr.ReadMessage()
		if err != nil {
			return nil, err
		}
		switch msg.Type {
		case 1: // SetChunkSize
			up.cr.chunkSize = int(be32(msg.Payload))
		case 20, 17: // AMF0 / AMF3 command
			return amfDecodeAll(msg.Payload), nil
		}
	}
}
