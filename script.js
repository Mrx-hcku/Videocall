const backendURL = 'https://vcall-dhkm.onrender.com'; 
const signalingURL = 'https://secb.onrender.com';

let socket;
let signalingSocket;
let localStream;
let peerConnection;

function loginUser(event) {
  event.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  fetch(`${backendURL}/login`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ username, password })
  }).then(res => res.json())
    .then(data => {
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', username);
        window.location.href = 'home.html';
      } else {
        alert(data.message);
      }
    });
}

function registerUser(event) {
  event.preventDefault();
  const username = document.getElementById('regUsername').value;
  const password = document.getElementById('regPassword').value;

  fetch(`${backendURL}/register`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ username, password })
  }).then(res => res.json())
    .then(data => {
      alert(data.message);
      window.location.href = 'index.html';
    });
}

function logout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

function initHome() {
  const username = localStorage.getItem('username');
  if (!username) {
    window.location.href = 'index.html';
  }
  document.getElementById('usernameDisplay').innerText = username;

  socket = new WebSocket('wss://vcall-dhkm.onrender.com');

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'register', username }));
    loadOnlineUsers();
    loadCallHistory();
  });

  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'call') {
      if (confirm(`${data.from} is calling you. Accept?`)) {
        socket.send(JSON.stringify({ type: 'answer', to: data.from, from: username }));
        localStorage.setItem('room', [username, data.from].sort().join('-'));
        window.location.href = 'call.html';
      } else {
        socket.send(JSON.stringify({ type: 'reject', to: data.from }));
      }
    }
  });
}

function loadOnlineUsers() {
  fetch(`${backendURL}/online`)
    .then(res => res.json())
    .then(users => {
      const container = document.getElementById('onlineUsers');
      container.innerHTML = '';
      users.forEach(user => {
        if (user.username !== localStorage.getItem('username')) {
          const btn = document.createElement('button');
          btn.innerText = `Call ${user.username}`;
          btn.onclick = () => {
            socket.send(JSON.stringify({ type: 'call', from: localStorage.getItem('username'), to: user.username }));
            localStorage.setItem('room', [localStorage.getItem('username'), user.username].sort().join('-'));
            window.location.href = 'call.html';
          };
          container.appendChild(btn);
        }
      });
    });
}

function loadCallHistory() {
  fetch(`${backendURL}/call-history`, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`
    }
  }).then(res => res.json())
    .then(logs => {
      const container = document.getElementById('callHistory');
      container.innerHTML = '';
      logs.forEach(log => {
        const div = document.createElement('div');
        div.innerText = `${log.caller} called ${log.receiver} (${log.status}) at ${new Date(log.timestamp).toLocaleString()}`;
        container.appendChild(div);
      });
    });
}

function startCall() {
  const room = localStorage.getItem('room');
  signalingSocket = io(signalingURL);

  navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
    localStream = stream;
    document.getElementById('localVideo').srcObject = stream;

    peerConnection = new RTCPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    signalingSocket.emit('join', room);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        signalingSocket.emit('ice-candidate', { room, candidate: event.candidate });
      }
    };

    signalingSocket.on('offer', async ({ offer }) => {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      signalingSocket.emit('answer', { room, answer });
    });

    signalingSocket.on('answer', async ({ answer }) => {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    });

    signalingSocket.on('ice-candidate', async ({ candidate }) => {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch (e) {
        console.error('Error adding ICE candidate', e);
      }
    });

    peerConnection.createOffer().then(offer => {
      peerConnection.setLocalDescription(offer);
      signalingSocket.emit('offer', { room, offer });
    });

  }).catch(err => {
    console.error('Media access denied', err);
  });
}

function endCall() {
  signalingSocket.emit('leave', localStorage.getItem('room'));
  localStream.getTracks().forEach(track => track.stop());
  peerConnection.close();
  window.location.href = 'home.html';
}