import { db } from './firebase-init.js';
import {
  ref,
  set,
  remove,
  onValue,
  get,
  onDisconnect,
  serverTimestamp
} from 'firebase/database';

const MAX_ROOM_PLAYERS = 12;
const MAX_PENDING_PAYLOADS = 75;
const COALESCED_PAYLOAD_TYPES = new Set(['entitySnapshot', 'entityStates']);
const PEER_RETRY_COOLDOWN_MS = 5000;
const PEER_LOG_THROTTLE_MS = 30000;
const PEER_HEARTBEAT_INTERVAL_MS = 5000;
const PEER_STALE_TIMEOUT_MS = 20000;

const isVerboseNetDebugEnabled = () => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.DEBUG_NET_VERBOSE);
};

const debugNetLog = (...args) => {
  if (isVerboseNetDebugEnabled()) {
    console.log(...args);
  }
};

export class Multiplayer {
  constructor(playerName, onPeerData, { botsOnly = false, forcedRoom = null } = {}) {
    this.connections = {};
    this.pendingConnections = new Set();
    this.pendingPayloads = new Map();
    this.pendingConnectionRetries = new Map();
    this.failedConnectionAt = new Map();
    this.pendingPings = {};
    this.onPeerData = onPeerData;
    this.playerName = playerName;
    this.botsOnly = botsOnly;
    this.forcedRoom = forcedRoom;
    this.isHost = false;
    this.currentHostId = null;
    this.onHostChange = null;
    this.onPeerDisconnect = null;
    this.onPeerConnected = null;
    this.onConnectionError = null;
    this.onPingUpdate = null;
    this.lastPingMs = null;
    this.lastPingAt = null;
    this.lastError = null;
    this.lastHostLogId = null;
    this.lastPeerLogKey = '';
    this.lastPeerLogAt = 0;
    this.lastValidPeerSetKey = '';
    this.lastOrderedPeerIds = [];
    this.peersCache = {};
    this.roomPeerIds = [];
    this.unsubscribePeersListener = null;
    this.unsubscribeRoomListener = null;
    this.hostRecalcTimer = null;
    this.heartbeatTimer = null;
    
    this.initPeer(); // Start async setup
  }

  async initPeer() {
    let iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
    const fetchTimeoutMs = 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

    try {
      const response = await fetch(
        `https://multiplayer-game.metered.live/api/v1/turn/credentials?apiKey=${import.meta.env.VITE_METERED_API_KEY}`,
        { signal: controller.signal }
      );
      if (!response.ok) {
        throw new Error(`TURN credential fetch failed with status ${response.status}`);
      }
      const dynamic = await response.json();
      if (!Array.isArray(dynamic)) {
        throw new Error('TURN credential response was not an array');
      }
      const turnServers = dynamic
        .filter(server => typeof server?.urls === 'string' && server.urls.startsWith('turn'))
        .slice(0, 2);
      if (turnServers.length > 0) {
        iceServers = [...iceServers, ...turnServers];
      }
    } catch (err) {
      console.warn('Failed to fetch TURN credentials. Falling back to STUN only.', err);
      this.recordError(err);
    } finally {
      clearTimeout(timeoutId);
    }
  
    this.peer = new Peer({
      config: { iceServers }
    });

    this.peer.on('open', async id => {
      this.id = id;

      const roomsRef = ref(db, 'rooms');
      const snapshot = await get(roomsRef);
      const peersSnapshot = await get(ref(db, 'peers'));
      const activePeers = peersSnapshot.exists() ? peersSnapshot.val() : {};
      const nowMs = Date.now();

      let assignedRoom = null;
      let roomIndex = 0;

      let isNewRoom = false;

      if (this.forcedRoom) {
        // Tournament room: join a specific named room
        assignedRoom = this.forcedRoom;
        const existingRooms = snapshot.exists() ? Object.keys(snapshot.val()) : [];
        isNewRoom = !existingRooms.includes(this.forcedRoom);
      } else if (this.botsOnly) {
        // Private bots-only room: find a unique unused room name so no public players can join
        const existingRoomNames = snapshot.exists() ? Object.keys(snapshot.val()) : [];
        let botRoomIndex = 0;
        while (existingRoomNames.includes(`bot-room-${botRoomIndex}`)) {
          botRoomIndex++;
        }
        assignedRoom = `bot-room-${botRoomIndex}`;
        isNewRoom = true;
      } else {
        if (snapshot.exists()) {
          const rooms = snapshot.val();
          const roomNames = Object.keys(rooms);

          for (const roomName of roomNames) {
            // Skip private bot rooms
            if (roomName.startsWith('bot-room-')) continue;
            const peersInRoom = Object.keys(rooms[roomName] || {})
              .filter(peerId => this.isPeerFresh(activePeers[peerId], nowMs));

            if (peersInRoom.length < MAX_ROOM_PLAYERS) {
              assignedRoom = roomName;
              debugNetLog('Entered room: ', assignedRoom);
              break;
            }
          }

          while (roomNames.includes(`room-${roomIndex}`)) {
            roomIndex++;
          }
        }

        if (!assignedRoom) {
          assignedRoom = `room-${roomIndex}`;
          isNewRoom = true;
        }
      }

      const roomRef = ref(db, `rooms/${assignedRoom}/${id}`);
      this.roomId = assignedRoom;
      await remove(roomRef);
      await set(roomRef, true);

      // Store server-authoritative game start time when we are the first active
      // peer in a room (new room OR re-entering an empty room after a previous
      // session), so the timestamp is always fresh for a new game.
      const isFirstActiveInRoom = isNewRoom ||
        (Object.keys(activePeers).filter(pid => {
          const p = activePeers[pid];
          return p?.roomId === assignedRoom && pid !== id && this.isPeerFresh(p, nowMs);
        }).length === 0);
      if (isFirstActiveInRoom) {
        await set(ref(db, `rooms/${assignedRoom}/startTime`), serverTimestamp());
      }

      const peerRef = ref(db, `peers/${id}`);
      await remove(peerRef);
      await set(peerRef, {
        name: this.playerName,
        roomId: assignedRoom,
        joinedAt: nowMs,
        timestamp: nowMs
      });
      this.startHeartbeat();

      onDisconnect(roomRef).remove();
      onDisconnect(peerRef).remove();

      window.addEventListener('beforeunload', () => {
        remove(roomRef);
        remove(peerRef);
      });

      this.attachPeersListener();
      this.attachRoomListener(assignedRoom);
    });

    this.peer.on('connection', conn => {
      this.setupConnection(conn);
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
        console.error('Peer call error:', err);
        this.recordError(err);
      });
    });

    this.peer.on('disconnected', () => {
      this.resetRealtimeListeners();
    });

    this.peer.on('close', () => {
      this.resetRealtimeListeners();
    });
  }

  attachPeersListener() {
    if (this.unsubscribePeersListener) {
      this.unsubscribePeersListener();
      this.unsubscribePeersListener = null;
    }
    this.unsubscribePeersListener = onValue(ref(db, 'peers'), snapshot => {
      this.peersCache = snapshot.val() || {};
      this.scheduleHostRecalculation();
      if (typeof this.onOnlineCount === 'function') {
        this.onOnlineCount(Object.keys(this.peersCache).length);
      }
    });
  }

  attachRoomListener(roomId) {
    if (!roomId) return;
    if (this.unsubscribeRoomListener) {
      this.unsubscribeRoomListener();
      this.unsubscribeRoomListener = null;
    }
    this.unsubscribeRoomListener = onValue(ref(db, `rooms/${roomId}`), snapshot => {
      const roomPeersObj = snapshot.val() || {};
      this.roomPeerIds = Object.keys(roomPeersObj);
      this.scheduleHostRecalculation();
    });
  }

  scheduleHostRecalculation() {
    if (this.hostRecalcTimer) return;
    this.hostRecalcTimer = setTimeout(() => {
      this.hostRecalcTimer = null;
      this.recalculateHostAndPeers();
    }, 25);
  }

  recalculateHostAndPeers() {
    const activePeers = this.peersCache || {};
    const nowMs = Date.now();
    const validPeerIds = (this.roomPeerIds || []).filter(pid => (
      pid === this.id || this.isPeerFresh(activePeers[pid], nowMs)
    ));
    const validPeerSetKey = validPeerIds.slice().sort().join(',');
    const previousHostId = this.currentHostId;
    const hostStillValid = previousHostId && validPeerIds.includes(previousHostId);

    let orderedPeerIds = this.lastOrderedPeerIds;
    const hasPeerSetChanged = validPeerSetKey !== this.lastValidPeerSetKey;
    if (hasPeerSetChanged || !hostStillValid) {
      orderedPeerIds = [...validPeerIds].sort((a, b) => {
        const joinedA = activePeers[a]?.joinedAt ?? activePeers[a]?.timestamp ?? 0;
        const joinedB = activePeers[b]?.joinedAt ?? activePeers[b]?.timestamp ?? 0;
        if (joinedA !== joinedB) return joinedA - joinedB;
        return a.localeCompare(b);
      });
      this.lastOrderedPeerIds = orderedPeerIds;
      this.lastValidPeerSetKey = validPeerSetKey;
    }

    const peerLogKey = `${this.id}|${orderedPeerIds.join(',')}`;
    if (isVerboseNetDebugEnabled() && (peerLogKey !== this.lastPeerLogKey || nowMs - this.lastPeerLogAt > PEER_LOG_THROTTLE_MS)) {
      debugNetLog('My ID:', this.id);
      debugNetLog('Valid Peers (oldest fresh first):', orderedPeerIds);
      this.lastPeerLogKey = peerLogKey;
      this.lastPeerLogAt = nowMs;
    }

    const hostPeerId = orderedPeerIds[0];
    this.currentHostId = hostPeerId;
    this.isHost = (hostPeerId === this.id);

    if (this.isHost && this.lastHostLogId !== this.id) {
      debugNetLog('👑 I am the host player');
      this.lastHostLogId = this.id;
    }

    if (previousHostId !== hostPeerId && typeof this.onHostChange === 'function') {
      try {
        this.onHostChange({
          previousHostId,
          newHostId: hostPeerId,
          isCurrentHost: this.isHost,
          roomPeerCount: validPeerIds.length
        });
      } catch (err) {
        console.warn('Host change callback failed:', err);
      }
    }

    for (const peerId of orderedPeerIds) {
      if (peerId !== this.id && !this.connections[peerId] && this.shouldAttemptConnection(peerId)) {
        this.connectToPeer(peerId);
      }
    }
  }

  resetRealtimeListeners() {
    if (this.unsubscribeRoomListener) {
      this.unsubscribeRoomListener();
      this.unsubscribeRoomListener = null;
    }
    if (this.unsubscribePeersListener) {
      this.unsubscribePeersListener();
      this.unsubscribePeersListener = null;
    }
    if (this.hostRecalcTimer) {
      clearTimeout(this.hostRecalcTimer);
      this.hostRecalcTimer = null;
    }
    this.stopHeartbeat();
  }

  isPeerFresh(peerData, nowMs = Date.now()) {
    if (!peerData) return false;
    const lastSeenAt = peerData.timestamp ?? peerData.joinedAt ?? 0;
    return nowMs - lastSeenAt <= PEER_STALE_TIMEOUT_MS;
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.id) return;
      const nowMs = Date.now();
      const myPeerData = this.peersCache?.[this.id];
      const updates = { timestamp: nowMs };
      if (myPeerData && !this.isPeerFresh(myPeerData, nowMs)) {
        updates.joinedAt = nowMs;
      }
      set(ref(db, `peers/${this.id}`), {
        ...myPeerData,
        name: this.playerName,
        roomId: this.roomId,
        ...updates
      }).catch(err => {
        console.warn('Failed to update peer heartbeat:', err);
        this.recordError(err);
      });
    }, PEER_HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  connectToPeer(peerId) {
    if (this.pendingConnections.has(peerId)) return;
    if (!this.peer || this.peer.destroyed) {
      console.warn('Peer connection not ready for', peerId);
      return;
    }
    const conn = this.peer.connect(peerId);
    if (!conn) {
      console.warn('Failed to create peer connection for', peerId);
      this.failedConnectionAt.set(peerId, Date.now());
      return;
    }
    this.pendingConnections.add(peerId);
    this.setupConnection(conn);
  }

  setupConnection(conn) {
    if (!conn || typeof conn.on !== 'function') {
      console.warn('Invalid peer connection', conn);
      if (conn?.peer) {
        this.pendingConnections.delete(conn.peer);
        this.failedConnectionAt.set(conn.peer, Date.now());
      }
      return;
    }

    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      this.pendingConnections.delete(conn.peer);
      this.failedConnectionAt.delete(conn.peer);
      this.clearConnectionRetry(conn.peer);
      debugNetLog('Connected to peer:', conn.peer);

      const queuedPayloads = this.pendingPayloads.get(conn.peer);
      if (queuedPayloads?.length) {
        queuedPayloads.forEach(payload => conn.send(payload));
        this.pendingPayloads.delete(conn.peer);
      }

      conn.on('data', data => this.handlePeerData(conn, data));
      this.runOneShotConnectionDiagnostics(conn);
      this.startPingLoop(conn);

      if (typeof this.onPeerConnected === 'function') {
        this.onPeerConnected(conn.peer);
      }
    });
  
    conn.on('close', () => {
      this.stopPingLoop(conn.peer);
      if (conn.diagnosticsTimeoutId) {
        clearTimeout(conn.diagnosticsTimeoutId);
        conn.diagnosticsTimeoutId = null;
      }
      delete this.connections[conn.peer];
      this.pendingConnections.delete(conn.peer);
      this.pendingPayloads.delete(conn.peer);
      this.clearConnectionRetry(conn.peer);
      this.onPeerDisconnect?.(conn.peer);
    });

    conn.on('error', err => {
      console.error('Peer error:', err);
      this.recordError(err);
      if (conn.diagnosticsTimeoutId) {
        clearTimeout(conn.diagnosticsTimeoutId);
        conn.diagnosticsTimeoutId = null;
      }
      if (conn?.peer) {
        this.pendingConnections.delete(conn.peer);
        this.failedConnectionAt.set(conn.peer, Date.now());
        this.pendingPayloads.delete(conn.peer);
        this.clearConnectionRetry(conn.peer);
      }
    });
  }

  handlePeerData(conn, data) {
    const isObjectPayload = data && typeof data === 'object' && !Array.isArray(data);
    if (!isObjectPayload) {
      console.warn('Dropping non-object peer payload', data);
      return;
    }
    if (data.type === 'ping') {
      conn.send({ type: 'pong', ts: data.ts || Date.now() });
      return;
    }
    if (data.type === 'pong') {
      const sentAt = data.ts || this.pendingPings?.[conn.peer];
      if (sentAt) {
        const rtt = Date.now() - sentAt;
        this.lastPingMs = rtt;
        this.lastPingAt = Date.now();
        this.onPingUpdate?.(rtt);
      }
      return;
    }
    this.onPeerData(conn.peer, data);
  }

  shouldAttemptConnection(peerId) {
    if (!peerId) return false;
    if (this.pendingConnections.has(peerId)) return false;
    const lastFailedAt = this.failedConnectionAt.get(peerId) || 0;
    return Date.now() - lastFailedAt > PEER_RETRY_COOLDOWN_MS;
  }

  clearConnectionRetry(peerId) {
    if (this.pendingConnectionRetries.has(peerId)) {
      clearTimeout(this.pendingConnectionRetries.get(peerId));
      this.pendingConnectionRetries.delete(peerId);
    }
  }

  startVoice(stream) {
    for (const peerId in this.connections) {
      const conn = this.connections[peerId];
      if (!conn.callActive) {
        this.peer.call(peerId, stream);
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

  handleIncomingVoice(peerId, stream) {
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    audio.playsInline = true; // iOS-specific

    audio.onloadedmetadata = () => {
      audio.play().catch(err => {
        console.warn(`Audio play failed for ${peerId}:`, err);
      });
    };

    if (this.voiceAudios?.[peerId]?.audio) {
      this.voiceAudios[peerId].audio.pause();
      this.voiceAudios[peerId].audio.srcObject = null;
    }

    this.voiceAudios = this.voiceAudios || {};
    this.voiceAudios[peerId] = { audio, stream };
  }

  send(data) {
    Object.values(this.connections).forEach(conn => {
      if (conn && typeof conn.send === 'function') {
        if (conn.open) {
          conn.send(data);
        } else if (typeof conn.once === 'function') {
          conn.once('open', () => conn.send(data));
        } else {
          console.warn('Invalid connection object', conn);
        }
      }
    });
  }

  getId() {
    return this.id;
  }

  getHostId() {
    return this.currentHostId;
  }

  sendTo(peerId, data) {
    if (!peerId || peerId === this.id) return;
    const existing = this.connections[peerId];
    if (existing && typeof existing.send === 'function') {
      if (existing.open) {
        existing.send(data);
        return;
      }
      this.enqueuePendingPayload(peerId, data);
      return;
    }

    try {
      if (this.pendingConnections.has(peerId)) {
        this.enqueuePendingPayload(peerId, data);
        return;
      }
      if (!this.shouldAttemptConnection(peerId)) {
        this.enqueuePendingPayload(peerId, data);
        this.scheduleConnectionRetry(peerId);
        return;
      }
      if (!this.peer || this.peer.destroyed) {
        console.warn('Peer connection not ready for', peerId);
        return;
      }
      const conn = this.peer.connect(peerId);
      this.pendingConnections.add(peerId);
      this.setupConnection(conn);
      this.enqueuePendingPayload(peerId, data);
    } catch (err) {
      console.warn(`Failed to send direct message to ${peerId}:`, err);
      this.recordError(err);
    }
  }

  enqueuePendingPayload(peerId, data) {
    if (!this.pendingPayloads.has(peerId)) {
      this.pendingPayloads.set(peerId, []);
    }
    const queue = this.pendingPayloads.get(peerId);
    if (data?.type && COALESCED_PAYLOAD_TYPES.has(data.type)) {
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i]?.type === data.type) {
          queue.splice(i, 1);
        }
      }
    }
    queue.push(data);
    if (queue.length > MAX_PENDING_PAYLOADS) {
      const dropCount = queue.length - MAX_PENDING_PAYLOADS;
      queue.splice(0, dropCount);
      console.warn(
        `Pending payload queue exceeded ${MAX_PENDING_PAYLOADS}; dropped ${dropCount} oldest messages for peer ${peerId}.`
      );
    }
  }

  scheduleConnectionRetry(peerId) {
    if (!peerId || this.pendingConnectionRetries.has(peerId)) return;
    const lastFailedAt = this.failedConnectionAt.get(peerId) || 0;
    const delayMs = Math.max(0, PEER_RETRY_COOLDOWN_MS - (Date.now() - lastFailedAt));
    const timeoutId = setTimeout(() => {
      this.pendingConnectionRetries.delete(peerId);
      if (!this.pendingPayloads.get(peerId)?.length) return;
      if (!this.shouldAttemptConnection(peerId)) {
        this.scheduleConnectionRetry(peerId);
        return;
      }
      this.connectToPeer(peerId);
    }, delayMs);
    this.pendingConnectionRetries.set(peerId, timeoutId);
  }

  recordError(err) {
    const message = err?.message || String(err || 'Unknown error');
    this.lastError = {
      message,
      timestamp: Date.now()
    };
    if (typeof this.onConnectionError === 'function') {
      this.onConnectionError(this.lastError);
    }
  }

  runOneShotConnectionDiagnostics(conn) {
    if (!isVerboseNetDebugEnabled()) return;
    const maxAttempts = 6;
    const attemptDelayMs = 1000;
    let attempts = 0;

    const runDiagnostics = async () => {
      attempts += 1;
      try {
        const pc = conn._pc || conn.peerConnection || conn._connection?.peerConnection;
        if (!pc) {
          if (attempts < maxAttempts) {
            conn.diagnosticsTimeoutId = setTimeout(runDiagnostics, attemptDelayMs);
          } else {
            debugNetLog('RTCPeerConnection not ready for', conn.peer);
          }
          return;
        }
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) return;

        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            debugNetLog(`🎯 Connected to peer ${conn.peer}`);
            debugNetLog('Selected candidate pair:');
            debugNetLog(`🔹 Local: ${report.localCandidateId}`);
            debugNetLog(`🔸 Remote: ${report.remoteCandidateId}`);
          }
        });
      } catch (err) {
        console.warn(`Could not access RTCPeerConnection stats for peer ${conn.peer}`, err);
      }
    };

    conn.diagnosticsTimeoutId = setTimeout(runDiagnostics, attemptDelayMs);
  }

  startPingLoop(conn) {
    if (!conn || !conn.peer) return;
    this.stopPingLoop(conn.peer);
    const intervalId = setInterval(() => {
      if (!conn.open) return;
      const ts = Date.now();
      this.pendingPings[conn.peer] = ts;
      conn.send({ type: 'ping', ts });
    }, 8000);
    conn.pingIntervalId = intervalId;
  }

  stopPingLoop(peerId) {
    const conn = this.connections?.[peerId];
    if (conn?.pingIntervalId) {
      clearInterval(conn.pingIntervalId);
      conn.pingIntervalId = null;
    }
    if (this.pendingPings?.[peerId]) {
      delete this.pendingPings[peerId];
    }
  }

  reconnect() {
    this.resetRealtimeListeners();
    this.attachPeersListener();
    this.attachRoomListener(this.roomId);
    if (this.peer?.disconnected) {
      try {
        this.peer.reconnect();
      } catch (err) {
        this.recordError(err);
      }
      return;
    }
    if (this.peer?.destroyed) {
      this.recordError(new Error('Peer connection was destroyed.'));
      return;
    }
    Object.keys(this.connections).forEach(peerId => {
      try {
        this.connectToPeer(peerId);
      } catch (err) {
        this.recordError(err);
      }
    });
  }
}

// Subscribe to online player count without being in the game yet.
// Returns an unsubscribe function.
export function subscribeOnlineCount(callback) {
  return onValue(ref(db, 'peers'), snapshot => {
    const peers = snapshot.val() || {};
    callback(Object.keys(peers).length);
  });
}
