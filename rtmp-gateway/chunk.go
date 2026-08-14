// RTMP chunk-layer reader + writer. Ported from the proven Python authmod
// responder (/tmp/rtmp_authmod.py) — the exact byte handling that OBS/librtmp
// negotiated against, byte-exact. fmt 0/1/2/3 headers + extended timestamps on
// fmt 0/1/2. (fmt-3 extended-timestamp re-read is not implemented: it only
// matters after ~4.6h of wall-clock stream time, well past any exam window.)
package main

import (
	"encoding/binary"
	"io"
)

// Message is one reassembled RTMP message.
type Message struct {
	Type      byte
	CSID      uint32
	StreamID  uint32
	Timestamp uint32
	Payload   []byte
}

type chunkState struct {
	ts, mlen uint32
	mtype    byte
	msid     uint32
	buf      []byte
}

// ---- byte helpers ----

func be24(b []byte) uint32 { return uint32(b[0])<<16 | uint32(b[1])<<8 | uint32(b[2]) }
func be32(b []byte) uint32 { return binary.BigEndian.Uint32(b) }
func le32(b []byte) uint32 { return binary.LittleEndian.Uint32(b) }

func putBe3(b []byte, v uint32) { b[0] = byte(v >> 16); b[1] = byte(v >> 8); b[2] = byte(v) }
func putBe4(v uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return b
}
func putLe4(v uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, v)
	return b
}

// readN reads exactly n bytes (io.ReadFull semantics); EOF on short read.
func readN(r io.Reader, n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

// ---- reader ----

type chunkReader struct {
	r         io.Reader
	chunkSize int
	states    map[uint32]*chunkState
}

func newChunkReader(r io.Reader) *chunkReader {
	return &chunkReader{r: r, chunkSize: 128, states: map[uint32]*chunkState{}}
}

func (cr *chunkReader) state(csid uint32) *chunkState {
	st, ok := cr.states[csid]
	if !ok {
		st = &chunkState{}
		cr.states[csid] = st
	}
	return st
}

// ReadMessage reassembles the next complete message across fmt 0-3 chunks.
func (cr *chunkReader) ReadMessage() (*Message, error) {
	for {
		bh, err := readN(cr.r, 1)
		if err != nil {
			return nil, err
		}
		fmt0 := (bh[0] >> 6) & 0x03
		csid := uint32(bh[0] & 0x3f)
		if csid == 0 {
			b, err := readN(cr.r, 1)
			if err != nil {
				return nil, err
			}
			csid = uint32(b[0]) + 64
		} else if csid == 1 {
			b2, err := readN(cr.r, 2)
			if err != nil {
				return nil, err
			}
			csid = uint32(b2[1])*256 + uint32(b2[0]) + 64
		}
		st := cr.state(csid)

		switch fmt0 {
		case 0:
			hdr, err := readN(cr.r, 11)
			if err != nil {
				return nil, err
			}
			ts := be24(hdr[0:3])
			mlen := be24(hdr[3:6])
			mtype := hdr[6]
			msid := le32(hdr[7:11])
			if ts == 0xFFFFFF {
				ext, err := readN(cr.r, 4)
				if err != nil {
					return nil, err
				}
				ts = be32(ext)
			}
			st.ts, st.mlen, st.mtype, st.msid, st.buf = ts, mlen, mtype, msid, st.buf[:0]
		case 1:
			hdr, err := readN(cr.r, 7)
			if err != nil {
				return nil, err
			}
			d := be24(hdr[0:3])
			mlen := be24(hdr[3:6])
			mtype := hdr[6]
			if d == 0xFFFFFF {
				ext, err := readN(cr.r, 4)
				if err != nil {
					return nil, err
				}
				d = be32(ext)
			}
			st.ts += d
			st.mlen, st.mtype = mlen, mtype
		case 2:
			hdr, err := readN(cr.r, 3)
			if err != nil {
				return nil, err
			}
			d := be24(hdr[0:3])
			if d == 0xFFFFFF {
				ext, err := readN(cr.r, 4)
				if err != nil {
					return nil, err
				}
				d = be32(ext)
			}
			st.ts += d
		case 3:
			// continuation — no header bytes follow.
		}

		need := int(st.mlen) - len(st.buf)
		if need > 0 {
			n := need
			if n > cr.chunkSize {
				n = cr.chunkSize
			}
			chunk, err := readN(cr.r, n)
			if err != nil {
				return nil, err
			}
			st.buf = append(st.buf, chunk...)
		}
		if st.mlen > 0 && len(st.buf) >= int(st.mlen) {
			payload := make([]byte, st.mlen)
			copy(payload, st.buf[:st.mlen])
			st.buf = st.buf[:0]
			return &Message{
				Type:      st.mtype,
				CSID:      csid,
				StreamID:  st.msid,
				Timestamp: st.ts,
				Payload:   payload,
			}, nil
		}
	}
}

// ---- writer ----

type chunkWriter struct {
	w         io.Writer
	chunkSize int
}

func newChunkWriter(w io.Writer) *chunkWriter {
	return &chunkWriter{w: w, chunkSize: 4096}
}

// WriteMessage emits a message as one fmt-0 chunk followed by fmt-3
// continuations (always-full first header — simple, correct, slightly verbose).
func (cw *chunkWriter) WriteMessage(m *Message) error {
	var hdr []byte
	hdr = append(hdr, byte(m.CSID&0x3f)) // fmt 0 (top two bits = 0)

	ext := m.Timestamp >= 0xFFFFFF
	ts3 := m.Timestamp
	if ext {
		ts3 = 0xFFFFFF
	}
	t := make([]byte, 3)
	putBe3(t, ts3)
	hdr = append(hdr, t...)
	l := make([]byte, 3)
	putBe3(l, uint32(len(m.Payload)))
	hdr = append(hdr, l...)
	hdr = append(hdr, m.Type)
	hdr = append(hdr, putLe4(m.StreamID)...)
	if ext {
		hdr = append(hdr, putBe4(m.Timestamp)...)
	}

	out := append(hdr, m.Payload[:min(cw.chunkSize, len(m.Payload))]...)
	for off := cw.chunkSize; off < len(m.Payload); off += cw.chunkSize {
		out = append(out, 0xc0|byte(m.CSID&0x3f)) // fmt 3 continuation
		end := off + cw.chunkSize
		if end > len(m.Payload) {
			end = len(m.Payload)
		}
		out = append(out, m.Payload[off:end]...)
	}
	_, err := cw.w.Write(out)
	return err
}
