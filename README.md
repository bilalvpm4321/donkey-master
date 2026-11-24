# Dockey Master

A responsive, real-time multiplayer card-game web app with private room codes, three card games, and optional peer-to-peer video.

## Requirements
- Node.js 18+
- npm

## Run locally
```bash
npm install
npm start
```
Open http://localhost:3000. Other devices on the same Wi-Fi can join using the host computer's LAN IP, for example `http://192.168.1.10:3000`. Allow the port through your firewall.

## Play over the internet
Deploy the project to a Node.js host that supports WebSockets (Render, Railway, Fly.io, VPS, etc.). Share the deployed HTTPS URL and room key. Camera/microphone access requires HTTPS (or localhost). For reliable video across restrictive networks, configure a TURN server and add its credentials to the `iceServers` array in `public/app.js`; the included public STUN server alone will not work on every network.

## Included
- Host and join rooms with a six-character key
- Real Donkey (3–6 players), Bluff (2–6), Book / Go Fish (2–6)
- Server-authoritative turns and private hands
- Responsive dark card-table UI
- Optional WebRTC camera/microphone with Socket.IO signaling

## Notes / rules
The supplied rules are implemented as the default house rules. Donkey's opening deals one Spade per other player who holds one; the A♠ is discarded with those cards. Donkey's initial deal distributes all 52 cards as evenly as possible. Bluff uses two jokers as wild cards; the claim rank stays fixed for a pile. Book uses four-card books and Go Fish-style turns.

This is a starter implementation, not a production-certified gaming service. Before public launch, add authentication, rate limiting, room expiry, reconnect/rejoin support, persistent match records, anti-cheat tests, and a TURN relay for dependable video. No real-money betting or payments are included.
