const socket=io();let me=null,room=null,hand=[],gamePrivate=null,selected=new Set(),localStream=null,peers={},currentRule="donkey";
const $=id=>document.getElementById(id);
function toast(s){const t=$("toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600)}
function show(id){$(id).classList.remove("hidden")}function hide(id){$(id).classList.add("hidden")}
function emitAck(event,data){return new Promise(resolve=>socket.emit(event,data,resolve))}
socket.on("connect",()=>$("connection").textContent="Connected");
socket.on("disconnect",()=>$("connection").textContent="Reconnecting…");
$("createBtn").onclick=async()=>{const name=$("hostName").value.trim()||"Host";const r=await emitAck("room:create",{name});if(r?.ok)enterRoom(r.code);};
$("joinBtn").onclick=async()=>{const name=$("joinName").value.trim()||"Player",code=$("roomCode").value.trim().toUpperCase();if(!code)return toast("Enter a room key first.");const r=await emitAck("room:join",{name,code});if(r?.ok)enterRoom(r.code);else toast(r?.error||"Could not join.");};
async function enterRoom(code){me=socket.id;show("room");hide("lobby");$("roomCodeDisplay").textContent=code;$("roomTitle").textContent="Room "+code;toast("You're in. Invite your crew!");}
$("copyCode").onclick=()=>{navigator.clipboard?.writeText($("roomCodeDisplay").textContent);toast("Room key copied.");};
$("leaveBtn").onclick=()=>{if(localStream){localStream.getTracks().forEach(t=>t.stop());}location.reload();};
socket.on("room:update",r=>{room=r;renderRoom();syncVideos();});
socket.on("game:private",d=>{hand=d.hand||[];gamePrivate=d.privateState;me=d.myId;renderHand();renderBoard();});
socket.on("notice",s=>{const p=document.createElement("p");p.textContent=s;$("activity").prepend(p);while($("activity").children.length>35)$("activity").lastChild.remove();});
function renderRoom(){if(!room)return;$("playerCount").textContent=room.players.length+"/6";$("roomSub").textContent=room.started?"Game in progress":"Waiting for your crew to arrive.";const meObj=room.players.find(p=>p.id===me);$("hostHint").textContent=meObj?.host?"You're the host. Choose a game to start.":"Waiting for the host to choose a game."; $("players").innerHTML=room.players.map(p=>`<div class="player-tile ${p.id===me?"me":""}"><div class="avatar">${esc(p.name[0]?.toUpperCase()||"?")}</div><div><strong>${esc(p.name)} ${p.id===me?"(you)":""}</strong><small>${p.host?"HOST · ":""}${p.finished?"SAFE · ":""}${p.video?"CAM ON":p.place?`PLACE ${p.place}`:"READY"}</small></div></div>`).join("");$("table").classList.toggle("hidden",!room.started&&!room.state);if(room.game){$("gameTitle").textContent=({donkey:"♠ Real Donkey",bluff:"🃏 Bluff",book:"📚 Book"})[room.game];renderBoard();}document.querySelectorAll(".game-choice").forEach(b=>b.disabled=!meObj?.host||room.started);}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function cardText(c){return c.rank==="JOKER"?"★":c.rank+c.suit}
function renderHand(){if(!$("hand"))return;$("handCount").textContent=hand.length+" cards";$("hand").innerHTML=hand.map((c,i)=>`<button class="playing-card ${["♥","♦"].includes(c.suit)?"red":""} ${selected.has(i)?"selected":""}" data-i="${i}"><span>${esc(c.rank==="JOKER"?"★":c.rank)}</span><small>${esc(c.suit)}</small></button>`).join("");$("hand").querySelectorAll("button").forEach(b=>b.onclick=()=>{const i=+b.dataset.i;if(selected.has(i))selected.delete(i);else selected.add(i);renderHand();});}
function renderBoard(){if(!room?.state||!room.game)return;const s=room.state,players=room.players,meIndex=players.findIndex(p=>p.id===me),turn=players[s.turn];$("turnStatus").textContent=turn?(turn.id===me?"YOUR TURN":turn.name+"'s turn"):s.phase;$("gameBoard").innerHTML="";
 const status=document.createElement("div");status.className="players-status";status.innerHTML=players.map((p,i)=>`<span class="status-chip ${i===s.turn?"active":""}">${esc(p.name)} · ${p.handCount} cards${p.books?` · ${p.books} books`:""}${p.finished?" · SAFE":""}</span>`).join("");$("gameBoard").append(status);
 const felt=document.createElement("div");felt.className="table-felt";
 if(room.game==="donkey"){if(s.table?.length){s.table.forEach(x=>{const p=players.find(p=>p.id===x.playerId);felt.append(cardEl(x.card,`${p?.name||"?"}`));});}else felt.innerHTML=`<div class="table-message">${s.phase==="finished"?"Game over. The last player is the Donkey.":"The table is clear.<br>Lead a card to start the trick."}</div>`;}
 if(room.game==="bluff"){for(let i=0;i<Math.min(s.pile,18);i++){const c=document.createElement("div");c.className="table-card back";c.textContent="";felt.append(c);}if(!s.pile)felt.innerHTML='<div class="table-message">The bluff pile is empty.<br>Who is brave enough to start?</div>';const claim=document.createElement("div");claim.className="table-message";claim.innerHTML=`Claim: <b>${s.rank||"—"}</b><br>${s.pile} cards in the pile`;felt.append(claim);}
 if(room.game==="book"){felt.innerHTML=`<div class="table-message">📚 Books completed: <b>${s.books?.length||0}</b><br>Cards left in draw pile: <b>${s.deck}</b><br>Collect all four cards of a rank to make a book.</div>`;}
 $("gameBoard").append(felt);renderActions();
}
function cardEl(c,name){const el=document.createElement("div");el.className="table-card "+(["♥","♦"].includes(c.suit)?"red":"");el.innerHTML=`<span>${esc(cardText(c))}</span><small>${esc(name)}</small>`;return el;}
function actionButton(label,fn,cls="ghost"){const b=document.createElement("button");b.className=cls;b.textContent=label;b.onclick=fn;return b;}
function renderActions(){const area=document.createElement("div");area.className="hand-actions";const s=room.state,meIndex=room.players.findIndex(p=>p.id===me),myTurn=s.turn===meIndex;
 if(room.game==="donkey"&&myTurn){hand.forEach((c,i)=>{if(s.phase==="following"&&hand.some(x=>x.suit===s.leadSuit)&&c.suit!==s.leadSuit)return;const b=actionButton("Play "+cardText(c),()=>{socket.emit("game:donkey-play",{index:i});}, "primary");area.append(b);});if(s.phase==="opening")area.innerHTML="";if(s.phase==="opening")hand.forEach((c,i)=>{if(c.rank==="A"&&c.suit==="♠")area.append(actionButton("Play A♠",()=>socket.emit("game:donkey-play",{index:i}),"primary"));});}
 if(room.game==="bluff"&&myTurn){const rank=$("claimRank")?.value||s.rank||"";const sel=[...selected].sort((a,b)=>a-b);const select=document.createElement("select");select.id="claimRank";select.innerHTML=(s.rank?[s.rank]:["2","3","4","5","6","7","8","9","10","J","Q","K","A"]).map(r=>`<option>${r}</option>`).join("");if(s.rank)select.disabled=true;area.append(select,actionButton("Play selected cards",()=>{const r=$("claimRank").value;if(!sel.length)return toast("Select at least one card.");socket.emit("game:bluff",{type:"play",indices:sel,rank:r});selected.clear();},"primary"),actionButton("Pass",()=>{selected.clear();socket.emit("game:bluff",{type:"pass"});}),actionButton("Call bluff",()=>socket.emit("game:bluff",{type:"challenge"})));if(s.lastPlay&&s.lastPlay.playerId===me)area.lastChild.disabled=true;}
 if(room.game==="book"&&myTurn){const target=document.createElement("select");target.id="bookTarget";target.innerHTML=room.players.filter(p=>p.id!==me&&p.handCount>0).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");const ranks=[...new Set(hand.map(c=>c.rank))];const rank=document.createElement("select");rank.id="bookRank";rank.innerHTML=ranks.map(r=>`<option>${r}</option>`).join("");area.append(target,rank,actionButton("Ask for card",()=>{if(!target.value)return toast("No eligible player to ask.");socket.emit("game:book",{type:"ask",targetId:target.value,rank:rank.value});},"primary"),actionButton("End turn",()=>socket.emit("game:book",{type:"end"})));}
 $("gameBoard").append(area);
}
document.querySelectorAll(".game-choice").forEach(b=>b.onclick=async()=>{const r=await emitAck("game:start",{game:b.dataset.game});if(!r?.ok)toast(r?.error||"Could not start game.");});
const RTC_CONFIG={iceServers:[{urls:"stun:stun.l.google.com:19302"},{urls:"stun:stun1.l.google.com:19302"},{urls:"stun:stun2.l.google.com:19302"}]};
const candidateQueues={};

function updateVideoPlaceholder(){
  const container=$("videos");if(!container)return;
  const tiles=container.querySelectorAll(".video-tile");
  let placeholder=container.querySelector(".video-placeholder");
  if(tiles.length>0){if(placeholder)placeholder.remove();}
  else if(!placeholder){container.innerHTML='<div class="video-placeholder"><span>◉</span><p>Camera party starts here</p><small>Turn on your camera to see your crew.</small></div>';}
}

function renderLocalVideo(){
  let tile=document.getElementById("video-local");
  if(!localStream){if(tile)tile.remove();updateVideoPlaceholder();return;}
  if(!tile){
    tile=document.createElement("div");tile.className="video-tile";tile.id="video-local";
    const video=document.createElement("video");video.autoplay=true;video.muted=true;video.playsInline=true;
    const label=document.createElement("span");label.textContent="You";
    tile.append(video,label);$("videos").prepend(tile);
  }
  const video=tile.querySelector("video");
  if(video.srcObject!==localStream)video.srcObject=localStream;
  video.play().catch(()=>{});
  updateVideoPlaceholder();
}

function renderRemoteVideo(peerId,stream){
  let tile=document.getElementById("video-"+peerId);
  const pObj=room?.players?.find(p=>p.id===peerId);
  const name=pObj?pObj.name:"Player";
  if(!tile){
    tile=document.createElement("div");tile.className="video-tile";tile.id="video-"+peerId;
    const v=document.createElement("video");v.autoplay=true;v.playsInline=true;
    const label=document.createElement("span");label.textContent=name;
    tile.append(v,label);$("videos").append(tile);
  }else{
    const label=tile.querySelector("span");if(label)label.textContent=name;
  }
  const video=tile.querySelector("video");
  if(video.srcObject!==stream)video.srcObject=stream;
  video.play().catch(e=>console.warn("Video play error:",e));
  updateVideoPlaceholder();
}

function removeRemoteVideo(peerId){
  const tile=document.getElementById("video-"+peerId);
  if(tile)tile.remove();
  if(peers[peerId]){try{peers[peerId].close();}catch(e){}delete peers[peerId];}
  delete candidateQueues[peerId];
  updateVideoPlaceholder();
}

function createPeerConnection(peerId){
  if(peers[peerId])return peers[peerId];
  candidateQueues[peerId]=[];
  const pc=new RTCPeerConnection(RTC_CONFIG);
  peers[peerId]=pc;
  if(localStream){localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));}
  pc.ontrack=e=>{if(e.streams&&e.streams[0])renderRemoteVideo(peerId,e.streams[0]);};
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("webrtc:signal",{to:peerId,signal:{candidate:e.candidate}});};
  pc.onconnectionstatechange=()=>{if(pc.connectionState==="disconnected"||pc.connectionState==="failed"||pc.connectionState==="closed")removeRemoteVideo(peerId);};
  return pc;
}

async function initiateCall(peerId){
  const pc=createPeerConnection(peerId);
  try{
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc:signal",{to:peerId,signal:{description:pc.localDescription}});
  }catch(err){console.warn("Offer error for",peerId,err);}
}

function restartPeer(peerId){
  if(peers[peerId]){try{peers[peerId].close();}catch(e){}delete peers[peerId];}
  initiateCall(peerId);
}

function syncVideos(){
  if(!room||!room.players)return;
  room.players.forEach(p=>{
    const tile=document.getElementById("video-"+p.id);
    if(tile){const l=tile.querySelector("span");if(l)l.textContent=p.name;}
  });
  Object.keys(peers).forEach(pid=>{
    const p=room.players.find(x=>x.id===pid);
    if(!p){removeRemoteVideo(pid);}
    else if(!p.video&&!localStream){removeRemoteVideo(pid);}
  });
  if(localStream){
    room.players.filter(p=>p.id!==me).forEach(p=>{
      if(!peers[p.id])initiateCall(p.id);
    });
  }
  updateVideoPlaceholder();
}

$("videoToggle").onclick=async()=>{
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
    return toast("Camera requires HTTPS or localhost.");
  }
  if(!localStream){
    try{
      localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
      $("videoToggle").textContent="◉ Camera on";
      socket.emit("video:status",{enabled:true});
      renderLocalVideo();
      if(room&&room.players){
        room.players.filter(p=>p.id!==me).forEach(p=>restartPeer(p.id));
      }
      toast("Camera enabled.");
    }catch(e){
      console.error(e);
      toast("Camera permission was not granted.");
    }
  }else{
    localStream.getTracks().forEach(t=>t.stop());
    localStream=null;
    $("videoToggle").textContent="◉ Turn on camera";
    socket.emit("video:status",{enabled:false});
    renderLocalVideo();
    Object.keys(peers).forEach(pid=>{
      const p=room?.players?.find(x=>x.id===pid);
      if(!p||!p.video){removeRemoteVideo(pid);}
      else{restartPeer(pid);}
    });
    toast("Camera turned off.");
  }
};

socket.on("webrtc:signal",async({from,signal})=>{
  if(!from||from===me)return;
  let pc=peers[from];
  if(!pc)pc=createPeerConnection(from);
  try{
    if(signal.description){
      const desc=signal.description;
      if(desc.type==="offer"){
        await pc.setRemoteDescription(new RTCSessionDescription(desc));
        if(localStream){
          const senders=pc.getSenders();
          localStream.getTracks().forEach(t=>{
            if(!senders.some(s=>s.track&&s.track.kind===t.kind))pc.addTrack(t,localStream);
          });
        }
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc:signal",{to:from,signal:{description:pc.localDescription}});
      }else if(desc.type==="answer"){
        await pc.setRemoteDescription(new RTCSessionDescription(desc));
      }
      if(candidateQueues[from]&&candidateQueues[from].length){
        for(const cand of candidateQueues[from]){
          try{await pc.addIceCandidate(new RTCIceCandidate(cand));}catch(e){console.warn(e);}
        }
        candidateQueues[from]=[];
      }
    }else if(signal.candidate){
      if(!pc.remoteDescription){
        candidateQueues[from]=candidateQueues[from]||[];
        candidateQueues[from].push(signal.candidate);
      }else{
        try{await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));}catch(e){console.warn(e);}
      }
    }
  }catch(err){console.warn("Signal error:",err);}
});
$("rulesBtn").onclick=()=>{show("rulesModal");showRule(currentRule);};$("closeRules").onclick=()=>hide("rulesModal");$("rulesModal").onclick=e=>{if(e.target.id==="rulesModal")hide("rulesModal");};
document.querySelectorAll("[data-rule]").forEach(b=>b.onclick=()=>showRule(b.dataset.rule));
function showRule(r){currentRule=r;document.querySelectorAll("[data-rule]").forEach(b=>b.classList.toggle("active",b.dataset.rule===r));const content={
 donkey:`<h3>Real Donkey · 3–6 players</h3><p>Use a standard 52-card deck. Rank order is A (high), K, Q, J, 10 down to 2. Deal every card; some players may have one extra.</p><p><b>Opening:</b> The holder of A♠ plays it. Each other player who has a Spade plays one Spade. Those opening cards are discarded; the A♠ holder leads the next trick.</p><p><b>Normal trick:</b> The leader plays any card. In turn, everyone must follow the led suit if they can. If all follow suit, the highest card of that suit wins and leads next.</p><p><b>Hit / Thulla:</b> If a player cannot follow suit, they play another suit. The trick stops immediately. The highest card of the led suit so far picks up every card on the table and leads next.</p><p><b>Finish:</b> A player who empties their hand is safe. Continue until one player remains; that player is the Donkey.</p><p><i>Digital note:</i> Opening deals one Spade per other player when available. Cards are otherwise played one at a time.</p>`,
 bluff:`<h3>Bluff · 2–6 players</h3><p>Use 52 cards plus 2 jokers. Deal all cards randomly. The first player chooses a rank and puts one or more cards face down, claiming they are that rank. Every later play in the same pile must claim that same rank. Jokers are wild and count as any rank.</p><p>On your turn, play one or more cards or pass. Any player may challenge the most recent claim. If every card played in that claim is the claimed rank or a Joker, the challenge fails and the challenger takes the whole pile. If any card is different, the bluff is caught and the player who made that claim takes the whole pile.</p><p>If everyone passes after a claim, the pile clears and the next player starts a new rank. First player to empty their hand wins; remaining finish order is based on who empties next.</p>`,
 book:`<h3>Book · 2–6 players</h3><p>Use a standard 52-card deck. Deal four cards to each player. On your turn, ask another player for a rank you already hold (for example, “Do you have a Queen?”).</p><p>If they have that rank, they must give you all cards of that rank and you ask again. If they do not, draw one card from the deck and your turn ends. Whenever you collect all four cards of a rank, place them down as a book.</p><p>You may only ask for a rank in your hand. Players with no cards are out of asking turns. When no more meaningful plays remain, the player with the most books wins. Memory is your best strategy: remember who asked for and collected which ranks.</p>`}[r];$("ruleContent").innerHTML=content;}
showRule("donkey");
