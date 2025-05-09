import { db } from './firebase-init.js';
import {
  ref,
  set,
  remove,
  onValue,
  get,
  onDisconnect
} from 'firebase/database';

export class Multiplayer {
  constructor(playerName, onPeerData) {
    this.connections = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;

    this.initPeer(); // Start async setup
  }

  async initPeer() {
    // Fetch TURN credentials
    const response = await fetch(`https://multiplayer-game.metered.live/api/v1/turn/credentials?apiKey=${import.meta.env.VITE_METERED_API_KEY}`);
    const dynamic = await response.json();

    const iceServers = [
      { urls: "stun:stun.l.google.com:19302" },
      ...dynamic
    ];

    this.peer = new Peer({
      config: { iceServers }
    });

    this.peer.on('open', async id => {
      this.id = id;

      const roomsRef = ref(db, 'rooms');
      const snapshot = await get(roomsRef);

      let assignedRoom = null;
      let roomIndex = 0;

      if (snapshot.exists()) {
        const rooms = snapshot.val();
        for (const roomName in rooms) {
          const peersInRoom = Object.keys(rooms[roomName]);
          if (peersInRoom.length < 20) {
            assignedRoom = roomName;
            console.log("Entered room: ", assignedRoom)
            break;
          }
          roomIndex++;
        }
      }

      if (!assignedRoom) {
        assignedRoom = `room-${roomIndex}`;
      }

      const roomRef = ref(db, `rooms/${assignedRoom}/${id}`);
      await set(roomRef, true);

      const peerRef = ref(db, `peers/${id}`);
      await set(peerRef, {
        name: this.playerName,
        roomId: assignedRoom,
        timestamp: Date.now()
      });

      // Setup server-side disconnection cleanup
      onDisconnect(roomRef).remove();
      onDisconnect(peerRef).remove();

      // Still use beforeunload for graceful exit (optional)
      window.addEventListener('beforeunload', () => {
        remove(roomRef);
        remove(peerRef);
      });

      onValue(ref(db, `rooms/${assignedRoom}`), snapshot => {
        const roomPeers = snapshot.val() || {};
        for (const peerId in roomPeers) {
          if (peerId !== this.id && !this.connections[peerId]) {
            this.connectToPeer(peerId);
            console.log("Connected to peer: ", peerId)
          }
        }
      });
    });

    this.peer.on('connection', conn => {
      try {
        this.setupConnection(conn);
      } catch (err) {
        console.error("Error in setupConnection:", err);
      }
    });

    this.peer.on('call', call => {
      call.answer(); // no stream sent

      call.on('stream', remoteStream => {
        this.handleIncomingVoice(call.peer, remoteStream);
      });

      call.on('close', () => {
        if (this.voiceAudios?.[call.peer]) {
          this.voiceAudios[call.peer].audio.pause();
          delete this.voiceAudios[call.peer];
        }
      });

      call.on('error', err => {
        console.warn(`Call error from ${call.peer}:`, err);
      });
    });
 

    onValue(ref(db, 'peers'), snapshot => {
      const peers = snapshot.val() || {};
    });
  }

  connectToPeer(peerId) {
    const conn = this.peer.connect(peerId);
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      conn.on('data', data => this.onPeerData(conn.peer, data));
  
      // Attempt to access the internal peer connection
      try {
        const interval = setInterval(async () => {
          // PeerJS sometimes delays access to the connection internals
          const pc = conn._pc || conn.peerConnection || conn._connection?.peerConnection;
          if (!pc) {
            console.warn("RTCPeerConnection not ready for", conn.peer);
            return;
          }
          if (pc && pc.connectionState === 'connected') {
            clearInterval(interval);
  
            const stats = await pc.getStats();
            stats.forEach(report => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                console.log(`🎯 Connected to peer ${conn.peer}`);
                console.log('Selected candidate pair:');
                console.log(`🔹 Local: ${report.localCandidateId}`);
                console.log(`🔸 Remote: ${report.remoteCandidateId}`);
              }
            });
          }
        }, 1000);
      } catch (err) {
        console.warn(`Could not access RTCPeerConnection for peer ${conn.peer}`, err);
      }
    });
  
    conn.on('close', () => {
      delete this.connections[conn.peer];
    });
  
    conn.on('error', err => {
      console.error('Peer error:', err);
    });
  }

  startVoice(stream) {
    for (const peerId in this.connections) {
      const conn = this.connections[peerId];
      if (!conn.callActive) {
        const call = this.peer.call(peerId, stream);
        conn.callActive = true;
      }
    }
  }
  
  stopVoice() {
    for (const peerId in this.voiceAudios || {}) {
      const { audio, stream } = this.voiceAudios[peerId];
      if (audio) {
        audio.pause();
        audio.srcObject = null;
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    }
    this.voiceAudios = {};
  }
  
  // handleIncomingVoice(peerId, stream) {
  //   const audio = new Audio();
  //   audio.srcObject = stream;
  //   audio.autoplay = true;
  //   audio.volume = 0; // Start muted
  //   this.voiceAudios = this.voiceAudios || {};
  //   this.voiceAudios[peerId] = { audio, stream };
  // }  

  handleIncomingVoice(peerId, stream) {
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.playsInline = true; // iOS-specific

    // Ensure audio can play (especially on mobile)
    audio.onloadedmetadata = () => {
      audio.play().catch(err => {
        console.warn(`Audio play failed for ${peerId}:`, err);
      });
    };

    // Prevent memory leaks from duplicates
    if (this.voiceAudios?.[peerId]?.audio) {
      this.voiceAudios[peerId].audio.pause();
      this.voiceAudios[peerId].audio.srcObject = null;
    }

    this.voiceAudios = this.voiceAudios || {};
    this.voiceAudios[peerId] = { audio, stream };
  }

  send(data) {
    Object.values(this.connections).forEach(conn => conn.send(data));
  }

  getId() {
    return this.id;
  }
}
