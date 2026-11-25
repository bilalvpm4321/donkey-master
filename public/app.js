/* ══════════════════════════════════════════════════════════════
   DONKEY MASTER – app.js
   Full redesign: themed game layouts, responsive, WebRTC fixed.
   ════════════════════════════════════════════════════════════ */

const socket = io();
let me = null, room = null, hand = [], gamePrivate = null;
let selected = new Set(), localStream = null, peers = {}, currentRule = "donkey";
const $ = id => document.getElementById(id);

/* ── Utilities ──────────────────────── */
function toast(s) {
  const t = $("toast");
  t.textContent = s;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}
function show(id) { const el = $(id); if (el) el.classList.remove("hidden"); }
function hide(id) { const el = $(id); if (el) el.classList.add("hidden"); }
function emitAck(event, data) { return new Promise(resolve => socket.emit(event, data, resolve)); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ── Card helpers ───────────────────── */
function cardText(c) { return c.rank === "JOKER" ? "☆" : c.rank + c.suit; }
function cardTitle(c) {
  if (!c) return "Card";
  if (c.rank === "JOKER" || c.joker) return (c.color === "RED" || c.variant === "RED") ? "Red Joker" : "Purple Joker";
  const sn = {"S":"Spades","♠":"Spades","H":"Hearts","♥":"Hearts","D":"Diamonds","♦":"Diamonds","C":"Clubs","♣":"Clubs"};
  const rn = {"A":"Ace","K":"King","Q":"Queen","J":"Jack","10":"10"};
  return `${rn[c.rank] || c.rank} of ${sn[c.suit] || c.suit}`;
}
function cardImageSrc(c) {
  if (!c) return "/assets/cards/back.svg";
  if (c.rank === "JOKER" || c.joker) {
    if (c.color === "RED" || c.variant === "RED" || c.suit === "RED" || c.suit === "♥" || c.suit === "♦") return "/assets/cards/JOKER_RED.png";
    return "/assets/cards/JOKER_PURPLE.png";
  }
  const sm = {"♠":"S","S":"S","SPADE":"S","SPADES":"S","♥":"H","H":"H","HEART":"H","HEARTS":"H","♦":"D","D":"D","DIAMOND":"D","DIAMONDS":"D","♣":"C","C":"C","CLUB":"C","CLUBS":"C"};
  const sl = sm[c.suit] || "S";
  const rank = String(c.rank).toUpperCase();
  return `/assets/cards/${rank}_${sl}.png`;
}

/* ── Connection ─────────────────────── */
socket.on("connect", () => { const el = document.querySelector(".conn-status"); if (el) el.textContent = "Connected"; });
socket.on("disconnect", () => { const el = document.querySelector(".conn-status"); if (el) el.textContent = "Reconnecting…"; });

/* ── Lobby ──────────────────────────── */
$("createBtn").onclick = async () => {
  const name = $("hostName").value.trim() || "Host";
  const r = await emitAck("room:create", { name });
  if (r?.ok) enterRoom(r.code);
};
$("joinBtn").onclick = async () => {
  const name = $("joinName").value.trim() || "Player";
  const code = $("roomCode").value.trim().toUpperCase();
  if (!code) return toast("Enter a room key first.");
  const r = await emitAck("room:join", { name, code });
  if (r?.ok) enterRoom(r.code);
  else toast(r?.error || "Could not join.");
};

async function enterRoom(code) {
  me = socket.id;
  show("room"); hide("lobby");
  $("roomCodeDisplay").textContent = code;
  show("lobbyState"); hide("gameArea"); hide("videoStrip");
  document.body.className = "";
  toast("You're in. Invite your crew!");
}

$("copyCode").onclick = () => {
  navigator.clipboard?.writeText($("roomCodeDisplay").textContent);
  toast("Room key copied.");
};
$("leaveBtn").onclick = () => {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  location.reload();
};

/* ── Room updates ───────────────────── */
socket.on("room:update", r => { room = r; renderRoom(); syncVideos(); });
socket.on("game:private", d => {
  hand = d.hand || [];
  gamePrivate = d.privateState;
  me = d.myId;
  renderHand();
  renderBoard();
});
socket.on("notice", s => {
  const p = document.createElement("p");
  p.textContent = s;
  $("activity").prepend(p);
  while ($("activity").children.length > 35) $("activity").lastChild.remove();
});

/* ── renderRoom ─────────────────────── */
function renderRoom() {
  if (!room) return;
  $("playerCount").textContent = room.players.length + "/6";

  const meObj = room.players.find(p => p.id === me);
  const $sub = $("roomSub");
  if ($sub) $sub.textContent = room.started ? "Game in progress" : "Waiting for your crew to arrive.";
  if ($("hostHint")) $("hostHint").textContent = "Click any game to open its table & show the UI.";

  // Players grid
  $("players").innerHTML = room.players.map(p => `
    <div class="player-tile ${p.id === me ? "me" : ""}">
      <div class="avatar">${esc(p.name[0]?.toUpperCase() || "?")}</div>
      <div>
        <strong>${esc(p.name)} ${p.id === me ? "(you)" : ""}</strong>
        <small>${p.host ? "HOST · " : ""}${p.finished ? "SAFE · " : ""}${p.video ? "CAM ON" : p.place ? `PLACE ${p.place}` : "READY"}</small>
      </div>
    </div>
  `).join("");

  if (room.game) {
    renderBoard();
    renderOpponents();
  }
  document.querySelectorAll(".game-choice").forEach(b => { b.disabled = false; });
}

/* ── Opponents arc ──────────────────── */
function renderOpponents() {
  const arc = $("opponentsArc");
  if (!arc || !room) return;
  const opponents = room.players.filter(p => p.id !== me);
  const s = room.state;
  const meIndex = room.players.findIndex(p => p.id === me);

  arc.innerHTML = opponents.map(p => {
    const idx = room.players.indexOf(p);
    const isActive = s && s.turn === idx;
    const count = p.handCount || 0;
    // Mini card backs for opponent hands
    const cardMinis = Array.from({ length: Math.min(count, 7) }, () =>
      `<div class="opp-card-mini"><img src="/assets/cards/back.svg" alt="card" /></div>`
    ).join("");
    return `
      <div class="opp-slot ${isActive ? "active" : ""}">
        <div class="opp-avatar">${esc(p.name[0]?.toUpperCase() || "?")}</div>
        <div class="opp-name">${esc(p.name)}</div>
        <div class="opp-cards">${cardMinis}</div>
        <div class="opp-info">${count} card${count !== 1 ? "s" : ""}${p.books ? ` · ${p.books}bk` : ""}${p.finished ? " · ✓" : ""}</div>
      </div>
    `;
  }).join("");
}

/* ── renderHand ─────────────────────── */
function renderHand() {
  const h = $("hand");
  if (!h) return;
  if ($("handCount")) $("handCount").textContent = hand.length + " cards";
  h.innerHTML = hand.map((c, i) => `
    <button class="playing-card ${selected.has(i) ? "selected" : ""}" data-i="${i}" title="${esc(cardTitle(c))}">
      <img class="card-img" src="${cardImageSrc(c)}" alt="${esc(cardTitle(c))}" draggable="false" />
    </button>
  `).join("");
  h.querySelectorAll(".playing-card").forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.i;
      if (selected.has(i)) selected.delete(i);
      else selected.add(i);
      renderHand();
      renderActions();
    };
  });
}

/* ── renderBoard ─────────────────────── */
function renderBoard() {
  if (!room?.state || !room.game) return;

  // Switch game area into view
  const inGame = room.started || room.state;
  if (inGame) {
    hide("lobbyState");
    show("gameArea");
    // Show compact video strip if any videos active
    const anyVideo = room.players.some(p => p.video) || !!localStream;
    if (anyVideo) show("videoStrip");
    // Apply theme
    document.body.className = "game-" + room.game;
  }

  if ($("gameTitle")) $("gameTitle").textContent = ({ donkey: "♠ Real Donkey", bluff: "🃏 Bluff", book: "📚 Book" })[room.game] || room.game;

  const s = room.state, players = room.players;
  const meIndex = players.findIndex(p => p.id === me);
  const turn = players[s.turn];
  if ($("turnStatus")) $("turnStatus").textContent = turn ? (turn.id === me ? "YOUR TURN" : turn.name + "'s turn") : (s.phase || "");

  renderOpponents();

  const board = $("gameBoard");
  board.innerHTML = "";

  // Status chips (compact row)
  const status = document.createElement("div");
  status.className = "players-status";
  status.innerHTML = players.map((p, i) =>
    `<span class="status-chip ${i === s.turn ? "active" : ""}">${esc(p.name)} · ${p.handCount}cd${p.books ? ` · ${p.books}bk` : ""}${p.finished ? " ✓" : ""}</span>`
  ).join("");
  board.append(status);

  const felt = document.createElement("div");
  felt.className = "table-felt";

  // ── DONKEY board ──
  if (room.game === "donkey") {
    if (s.table?.length) {
      s.table.forEach(x => {
        const p = players.find(p => p.id === x.playerId);
        felt.append(cardEl(x.card, p?.name || "?"));
      });
    } else {
      felt.innerHTML = `<div class="table-message">${s.phase === "finished" ? "Game over. The last player is the Donkey." : "The table is clear.<br>Lead a card to start the trick."}</div>`;
    }
  }

  // ── BLUFF board ──
  if (room.game === "bluff") {
    const pileCount = s.pile || 0;
    const pileWrap = document.createElement("div");
    pileWrap.className = "bluff-pile-wrap";
    if (pileCount > 0) {
      for (let i = 0; i < Math.min(pileCount, 8); i++) {
        const c = document.createElement("div");
        c.className = "table-card back";
        const rot = ((i % 5) - 2) * 5;
        const tx = ((i % 3) - 1) * 3;
        c.style.cssText = `transform:rotate(${rot}deg) translate(${tx}px,${i * -1}px);z-index:${i};position:absolute;top:50%;left:50%;margin-top:-49px;margin-left:-34px;`;
        c.innerHTML = `<img class="card-img" src="/assets/cards/back.svg" alt="Card back" draggable="false" />`;
        pileWrap.append(c);
      }
    } else {
      pileWrap.innerHTML = `<div class="table-message">The bluff pile is empty.<br>Who dares to start?</div>`;
    }
    felt.append(pileWrap);

    // Bluff info box
    const infoBox = document.createElement("div");
    infoBox.className = "bluff-claim-box";
    if (s.rank) {
      infoBox.innerHTML = `
        <div class="bluff-rank">${esc(s.rank)}</div>
        <div class="bluff-sub">${pileCount} card${pileCount !== 1 ? "s" : ""} (Truth or Bluff?)</div>
        <div class="bluff-pile-count">${s.lastPlay ? `${esc(s.lastPlay.count || "?")} played last` : "New round"}</div>
      `;
    } else {
      infoBox.innerHTML = `<div class="bluff-sub">Choose a rank and play your cards.</div>`;
    }
    felt.append(infoBox);
  }

  // ── BOOK board ──
  if (room.game === "book") {
    const deckCount = s.deck ? (Array.isArray(s.deck) ? s.deck.length : s.deck) : 0;
    const booksCount = s.books?.length || 0;

    const deckEl = document.createElement("div");
    deckEl.className = "table-card back";
    deckEl.style.cssText = "width:68px;height:98px;";
    deckEl.innerHTML = `<img class="card-img" src="/assets/cards/back.svg" alt="Draw deck" /><span class="card-owner">${deckCount} left</span>`;
    felt.append(deckEl);

    const msg = document.createElement("div");
    msg.className = "table-message";
    msg.innerHTML = `📚 Books completed: <b>${booksCount}</b><br><small>Collect all 4 of a rank to book it.</small>`;
    felt.append(msg);
  }

  board.append(felt);
  renderActions();
}

/* ── cardEl (table card with name) ─── */
function cardEl(c, name) {
  const el = document.createElement("div");
  el.className = "table-card";
  el.title = `${name}: ${cardTitle(c)}`;
  el.innerHTML = `<img class="card-img" src="${cardImageSrc(c)}" alt="${esc(cardTitle(c))}" draggable="false" /><span class="card-owner">${esc(name)}</span>`;
  return el;
}

/* ── renderActions ───────────────────── */
function renderActions() {
  const area = $("handActions");
  if (!area || !room?.state) return;
  area.innerHTML = "";
  const s = room.state;
  const meIndex = room.players.findIndex(p => p.id === me);
  const myTurn = s.turn === meIndex;

  // ── DONKEY actions ──
  if (room.game === "donkey" && myTurn) {
    if (s.phase === "opening") {
      hand.forEach((c, i) => {
        if (c.rank === "A" && (c.suit === "♠" || c.suit === "S")) {
          area.append(actionBtn(`<img class="btn-card-icon" src="${cardImageSrc(c)}" alt="" /> Play A♠`, () => socket.emit("game:donkey-play", { index: i }), "primary"));
        }
      });
    } else {
      hand.forEach((c, i) => {
        if (s.phase === "following" && hand.some(x => x.suit === s.leadSuit) && c.suit !== s.leadSuit) return;
        area.append(actionBtn(`<img class="btn-card-icon" src="${cardImageSrc(c)}" alt="" /> Play ${cardText(c)}`, () => socket.emit("game:donkey-play", { index: i }), "primary"));
      });
    }
  }

  // ── BLUFF actions ──
  if (room.game === "bluff" && myTurn) {
    const sel = [...selected].sort((a, b) => a - b);
    const selectEl = document.createElement("select");
    selectEl.id = "claimRank";
    selectEl.innerHTML = (s.rank ? [s.rank] : ["2","3","4","5","6","7","8","9","10","J","Q","K","A"]).map(r => `<option>${r}</option>`).join("");
    if (s.rank) selectEl.disabled = true;

    const playBtn = actionBtn(sel.length ? `Play ${sel.length} card${sel.length > 1 ? "s" : ""}` : "Select cards to play", () => {
      const r = $("claimRank")?.value;
      if (!sel.length) return toast("Select at least one card.");
      socket.emit("game:bluff", { type: "play", indices: sel, rank: r });
      selected.clear();
    }, "primary");

    const passBtn = actionBtn("Pass", () => { selected.clear(); socket.emit("game:bluff", { type: "pass" }); }, "ghost");
    const callBtn = actionBtn("Call Bluff", () => socket.emit("game:bluff", { type: "challenge" }), "btn-call-bluff");
    if (s.lastPlay && s.lastPlay.playerId === me) callBtn.disabled = true;

    area.append(selectEl, playBtn, passBtn, callBtn);
  }

  // ── BOOK actions ──
  if (room.game === "book" && myTurn) {
    const targetEl = document.createElement("select");
    targetEl.id = "bookTarget";
    targetEl.innerHTML = room.players.filter(p => p.id !== me && p.handCount > 0).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");

    const ranks = [...new Set(hand.map(c => c.rank))];
    const rankEl = document.createElement("select");
    rankEl.id = "bookRank";
    rankEl.innerHTML = ranks.map(r => `<option>${r}</option>`).join("");

    area.append(
      targetEl, rankEl,
      actionBtn("Ask for card", () => { if (!targetEl.value) return toast("No eligible player."); socket.emit("game:book", { type: "ask", targetId: targetEl.value, rank: rankEl.value }); }, "primary"),
      actionBtn("End turn", () => socket.emit("game:book", { type: "end" }), "ghost")
    );
  }
}

function actionBtn(label, fn, cls = "ghost") {
  const b = document.createElement("button");
  b.className = cls;
  b.innerHTML = label;
  b.onclick = fn;
  return b;
}

/* ── Game preview (solo / host) ──────── */
function openGamePreview(gameType) {
  me = me || socket.id || "me";
  if (!room) {
    room = {
      code: "DEMO",
      players: [
        { id: me, name: "You", host: true, handCount: 7, books: 0 },
        { id: "demo-1", name: "Alex", host: false, handCount: 6, books: 0 },
        { id: "demo-2", name: "Sam", host: false, handCount: 5, books: 0 }
      ],
      started: true, game: gameType
    };
  }
  room.started = true;
  room.game = gameType;
  if (!room.players.some(p => p.id === me)) room.players.unshift({ id: me, name: "You", host: true, handCount: 7, books: 0 });
  while (room.players.length < 3) {
    const idx = room.players.length;
    room.players.push({ id: "demo-" + idx, name: "Player " + (idx + 1), handCount: 5, books: 0 });
  }

  if (gameType === "donkey") {
    hand = [{ rank: "K", suit: "♠" }, { rank: "Q", suit: "♥" }, { rank: "10", suit: "♥" }, { rank: "8", suit: "♣" }, { rank: "7", suit: "♣" }, { rank: "4", suit: "♦" }];
    room.state = { phase: "normal", turn: 0, table: [{ playerId: "demo-1", card: { rank: "A", suit: "♠" } }], leadSuit: "♠" };
    room.players.forEach((p, i) => { p.handCount = [6, 7, 5][i] || 5; });
  } else if (gameType === "bluff") {
    hand = [{ rank: "K", suit: "♥" }, { rank: "K", suit: "♦" }, { rank: "J", suit: "♠" }, { rank: "10", suit: "♣" }, { rank: "8", suit: "♥" }, { rank: "6", suit: "♦" }];
    room.state = { phase: "play", turn: 0, rank: "Q", pile: 4, lastPlay: { playerId: "demo-1", claimed: "Q", count: 2, cards: [] }, passes: 0 };
    room.players.forEach((p, i) => { p.handCount = [6, 8, 7][i] || 6; });
  } else if (gameType === "book") {
    hand = [{ rank: "A", suit: "♥" }, { rank: "A", suit: "♦" }, { rank: "8", suit: "♣" }, { rank: "J", suit: "♠" }];
    room.state = { phase: "ask", turn: 0, deck: 32, books: [{ player: "Alex", rank: "Q" }] };
    room.players.forEach((p, i) => { p.handCount = [4, 6, 5][i] || 4; });
  }

  show("room"); hide("lobby");
  renderBoard();
  renderHand();
  toast(gameType.toUpperCase() + " table opened!");
}

/* ── Game choice buttons ─────────────── */
document.querySelectorAll(".game-choice").forEach(b => b.onclick = async () => {
  openGamePreview(b.dataset.game);
  try { await emitAck("game:start", { game: b.dataset.game }); } catch (e) {}
});

/* ══════════════════════════════════════
   WebRTC VIDEO
   ════════════════════════════════════ */
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:openrelay.metered.ca:80" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  ],
  iceCandidatePoolSize: 10
};
const candidateQueues = {};

/* ── Video tile management ───────────── */
function getOrCreateVideoTile(peerId, name, container) {
  let tile = document.getElementById("video-" + peerId);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "video-tile";
    tile.id = "video-" + peerId;
    const v = document.createElement("video");
    v.autoplay = true; v.muted = true; v.playsInline = true;
    v.setAttribute("autoplay", ""); v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    const a = document.createElement("audio");
    a.autoplay = true;
    const lbl = document.createElement("span");
    lbl.textContent = name || "Player";
    tile.append(v, a, lbl);
    if (container) container.append(tile);
  } else {
    const lbl = tile.querySelector("span");
    if (lbl) lbl.textContent = name || "Player";
  }
  return tile;
}

function renderLocalVideo() {
  // Update both videos container (lobby) and strip (game)
  const containers = [$("videos"), $("stripVideos")].filter(Boolean);
  containers.forEach(container => {
    let tile = container.querySelector("#video-local");
    if (!localStream) { if (tile) tile.remove(); return; }
    if (!tile) {
      tile = document.createElement("div");
      tile.className = "video-tile";
      tile.id = "video-local";
      const v = document.createElement("video");
      v.autoplay = true; v.muted = true; v.playsInline = true;
      v.setAttribute("autoplay", ""); v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
      const lbl = document.createElement("span");
      lbl.textContent = "You";
      tile.append(v, lbl);
      container.prepend(tile);
    }
    const v = tile.querySelector("video");
    if (v.srcObject !== localStream) v.srcObject = localStream;
    v.play().catch(() => {});
  });
  updateVideoPlaceholder();
}

function renderRemoteVideo(peerId, track, stream) {
  const pObj = room?.players?.find(p => p.id === peerId);
  const name = pObj ? pObj.name : "Player";

  // Add to both lobby videos and game strip
  const containers = [$("videos"), $("stripVideos")].filter(Boolean);
  containers.forEach(container => {
    const tile = getOrCreateVideoTile(peerId, name, container);
    const video = tile.querySelector("video");
    const audio = tile.querySelector("audio");

    if (track && track.kind === "video") {
      const vStream = stream || new MediaStream([track]);
      if (video && video.srcObject !== vStream) video.srcObject = vStream;
      if (video) video.play().catch(() => {});
      if (track.onunmute !== undefined) track.onunmute = () => { if (video) video.play().catch(() => {}); };
    } else if (track && track.kind === "audio") {
      if (audio) {
        const aStream = stream || new MediaStream([track]);
        if (audio.srcObject !== aStream) audio.srcObject = aStream;
        audio.play().catch(() => {});
        if (track.onunmute !== undefined) track.onunmute = () => audio.play().catch(() => {});
      }
    } else if (stream) {
      if (video && video.srcObject !== stream) video.srcObject = stream;
      if (video) video.play().catch(() => {});
    }
  });
  updateVideoPlaceholder();
}

function removeRemoteVideo(peerId) {
  document.querySelectorAll("#video-" + peerId).forEach(tile => tile.remove());
  if (peers[peerId]) { try { peers[peerId].close(); } catch (e) {} delete peers[peerId]; }
  delete candidateQueues[peerId];
  updateVideoPlaceholder();
}

function updateVideoPlaceholder() {
  const container = $("videos");
  if (!container) return;
  const tiles = container.querySelectorAll(".video-tile");
  let placeholder = container.querySelector(".video-placeholder");
  if (tiles.length > 0) { if (placeholder) placeholder.remove(); }
  else if (!placeholder) {
    container.innerHTML = '<div class="video-placeholder"><span>◉</span><p>Camera party starts here</p><small>Turn on your camera to see your crew.</small></div>';
  }

  // Show/hide video strip based on whether game is active and there are videos
  const anyVideos = document.querySelectorAll(".video-tile").length > 0;
  const inGame = room?.started || room?.state;
  if (anyVideos && inGame) show("videoStrip"); else if (!anyVideos) hide("videoStrip");
}

/* ── Peer connections ────────────────── */
function createPeerConnection(peerId) {
  if (peers[peerId]) return peers[peerId];
  candidateQueues[peerId] = [];
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[peerId] = pc;

  // Add local tracks if we have a stream
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.ontrack = e => {
    renderRemoteVideo(peerId, e.track, (e.streams && e.streams[0]) ? e.streams[0] : null);
  };
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("webrtc:signal", { to: peerId, signal: { candidate: e.candidate } });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") removeRemoteVideo(peerId);
  };
  return pc;
}

async function initiateCall(peerId) {
  const pc = createPeerConnection(peerId);
  try {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    socket.emit("webrtc:signal", { to: peerId, signal: { description: pc.localDescription } });
  } catch (err) { console.warn("Offer error for", peerId, err); }
}

function restartPeer(peerId) {
  if (peers[peerId]) { try { peers[peerId].close(); } catch (e) {} delete peers[peerId]; }
  initiateCall(peerId);
}

/* ── KEY FIX: syncVideos ─────────────────────────────────────────
   Previously only initiated calls when localStream was active.
   Now: if ANY remote player has video on, we establish a connection
   so we can RECEIVE their stream even when our own camera is off.
   ──────────────────────────────────────────────────────────────── */
function syncVideos() {
  if (!room || !room.players) return;

  // Update labels
  room.players.forEach(p => {
    document.querySelectorAll("#video-" + p.id).forEach(tile => {
      const lbl = tile.querySelector("span");
      if (lbl) lbl.textContent = p.name;
    });
  });

  // Remove peers for players who left or have no video AND we have no local stream
  Object.keys(peers).forEach(pid => {
    const p = room.players.find(x => x.id === pid);
    if (!p) { removeRemoteVideo(pid); return; }
    // Keep connection if remote has video OR we have local stream
    if (!p.video && !localStream) removeRemoteVideo(pid);
  });

  // Establish connections:
  // 1) If we have local stream → call everyone
  // 2) If a remote player has video ON → establish a connection to receive it
  //    (the offerer is the one with local stream, receiver waits for offer)
  //    But if we have no local stream and remote does, we still need a peer
  //    to receive their offer — we do this by creating the peer so we're ready.
  room.players.filter(p => p.id !== me).forEach(p => {
    const hasRemoteVideo = p.video;
    const needsPeer = localStream || hasRemoteVideo;

    if (needsPeer && !peers[p.id]) {
      if (localStream) {
        // We have camera → we initiate the offer
        initiateCall(p.id);
      } else {
        // We don't have camera but they do → create peer connection so we're
        // ready to receive their offer (they will call us when they see our socket)
        // Don't send an offer — just pre-create so ICE candidates can queue
        createPeerConnection(p.id);
      }
    } else if (localStream && peers[p.id]) {
      // Already have peer, check if we need to renegotiate
    }
  });

  updateVideoPlaceholder();
}

/* ── Audio unlock ────────────────────── */
const unlockAudio = () => {
  document.querySelectorAll(".video-tile audio,.video-tile video").forEach(el => {
    if (el.srcObject && el.paused) el.play().catch(() => {});
  });
};
document.addEventListener("click", unlockAudio);
document.addEventListener("touchstart", unlockAudio);

/* ── Camera toggle ───────────────────── */
$("videoToggle").onclick = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast("Camera requires HTTPS or localhost.");

  if (!localStream) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        audio: true
      });
      // Update button
      $("videoToggle").innerHTML = '<span class="cam-dot on"></span>Camera on';
      socket.emit("video:status", { enabled: true });
      renderLocalVideo();
      // Restart all peers with new stream
      if (room && room.players) room.players.filter(p => p.id !== me).forEach(p => restartPeer(p.id));
      toast("Camera enabled.");
    } catch (e) {
      console.error(e);
      toast("Camera permission was not granted.");
    }
  } else {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    $("videoToggle").innerHTML = '<span class="cam-dot off"></span>Turn on camera';
    socket.emit("video:status", { enabled: false });
    renderLocalVideo();
    Object.keys(peers).forEach(pid => {
      const p = room?.players?.find(x => x.id === pid);
      if (!p || !p.video) removeRemoteVideo(pid);
      else restartPeer(pid);
    });
    toast("Camera turned off.");
  }
};

/* ── WebRTC signal handler ───────────── */
socket.on("webrtc:signal", async ({ from, signal }) => {
  if (!from || from === me) return;
  try {
    if (signal.description) {
      const desc = signal.description;
      if (desc.type === "offer") {
        // Received an offer → clean up old peer, create new one, answer
        if (peers[from]) { try { peers[from].close(); } catch (e) {} delete peers[from]; }
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(desc));
        // Add local tracks if we have a stream (so they receive our video too)
        if (localStream) {
          const senders = pc.getSenders();
          localStream.getTracks().forEach(t => {
            if (!senders.some(s => s.track && s.track.kind === t.kind)) pc.addTrack(t, localStream);
          });
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc:signal", { to: from, signal: { description: pc.localDescription } });
        // Drain queued ICE candidates
        if (candidateQueues[from]?.length) {
          for (const cand of candidateQueues[from]) {
            try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.warn(e); }
          }
          candidateQueues[from] = [];
        }
      } else if (desc.type === "answer") {
        const pc = peers[from];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(desc));
          // Drain queued ICE candidates
          if (candidateQueues[from]?.length) {
            for (const cand of candidateQueues[from]) {
              try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) { console.warn(e); }
            }
            candidateQueues[from] = [];
          }
        }
      }
    } else if (signal.candidate) {
      let pc = peers[from];
      if (!pc) pc = createPeerConnection(from);
      if (!pc.remoteDescription) {
        candidateQueues[from] = candidateQueues[from] || [];
        candidateQueues[from].push(signal.candidate);
      } else {
        try { await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)); } catch (e) { console.warn(e); }
      }
    }
  } catch (err) { console.warn("Signal error:", err); }
});

/* ══════════════════════════════════════
   RULES MODAL
   ════════════════════════════════════ */
// Rules button (if present on lobby, add it dynamically since we removed it)
document.querySelectorAll("[data-rule]").forEach(b => b.onclick = () => showRule(b.dataset.rule));

function showRule(r) {
  currentRule = r;
  document.querySelectorAll("[data-rule]").forEach(b => b.classList.toggle("active", b.dataset.rule === r));
  const content = {
    donkey: `<h3>Real Donkey · 3–6 players</h3><p>Use a standard 52-card deck. Rank order is A (high), K, Q, J, 10 down to 2. Deal every card; some players may have one extra.</p><p><b>Opening:</b> The holder of A♠ plays it. Each other player who has a Spade plays one Spade. Those opening cards are discarded; the A♠ holder leads the next trick.</p><p><b>Normal trick:</b> The leader plays any card. In turn, everyone must follow the led suit if they can. If all follow suit, the highest card of that suit wins and leads next.</p><p><b>Hit / Thulla:</b> If a player cannot follow suit, they play another suit. The trick stops immediately. The highest card of the led suit so far picks up every card on the table and leads next.</p><p><b>Finish:</b> A player who empties their hand is safe. Continue until one player remains; that player is the Donkey.</p>`,
    bluff: `<h3>Bluff · 2–6 players</h3><p>Use 52 cards plus 2 jokers. Deal all cards randomly. The first player chooses a rank and puts one or more cards face down, claiming they are that rank. Every later play in the same pile must claim that same rank. Jokers are wild.</p><p>On your turn, play one or more cards or pass. Any player may challenge the most recent claim. If the claim was truthful, the challenger takes the pile. If the bluff is caught, the bluffer takes the pile.</p><p>If everyone passes after a claim, the pile clears and the next player starts a new rank. First player to empty their hand wins.</p>`,
    book: `<h3>Book · 2–6 players</h3><p>Use a standard 52-card deck. Deal four cards to each player. On your turn, ask another player for a rank you already hold.</p><p>If they have that rank, they give you all cards of that rank and you ask again. If they don't, draw one card from the deck and your turn ends. Whenever you collect all four cards of a rank, place them down as a book.</p><p>The player with the most books wins. Memory is your best strategy.</p>`
  }[r] || "";
  if ($("ruleContent")) $("ruleContent").innerHTML = content;
}
showRule("donkey");

if ($("closeRules")) $("closeRules").onclick = () => hide("rulesModal");
if ($("rulesModal")) $("rulesModal").onclick = e => { if (e.target.id === "rulesModal") hide("rulesModal"); };
