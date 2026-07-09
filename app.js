// ============================================================================
// SwapPoint — logique de l'application
// ============================================================================

import firebaseConfig from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

/* ===================== INITIALISATION FIREBASE ===================== */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
});

/* ===================== ÉTAT ===================== */
let agents = [];
let stations = [];
let presences = [];
let config = { radius: 10 };
let selectedAgent = null;
let currentUser = null;
let isAdmin = false;
let presencesUnsub = null;
let configReady = false;

/* ===================== UTILITAIRES ===================== */
function normalize(s){
  return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function slugify(s){
  return normalize(s).replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || ('s-'+Date.now());
}
function haversine(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function nearestStation(lat, lon){
  if(!stations.length) return null;
  let best = null, bestD = Infinity;
  stations.forEach(s=>{
    const d = haversine(lat, lon, s.lat, s.lng);
    if(d < bestD){ bestD = d; best = s; }
  });
  return { station: best, distance: bestD };
}
function fmtDate(ts){ return new Date(ts).toLocaleDateString('fr-FR'); }
function fmtTime(ts){ return new Date(ts).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }
function dateKey(ts){
  const d = new Date(ts);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function escapeHtml(s){
  return (s===undefined||s===null?'':String(s)).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function uid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2);
}

function toast(msg, kind){
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = 'toast ' + (kind||'');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(), 300); }, 3400);
}
function confirmModal(title, text){
  return new Promise(resolve=>{
    const bg = document.getElementById('modal-bg');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    bg.classList.add('active');
    const okBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');
    const cleanup = (val)=>{ bg.classList.remove('active'); okBtn.removeEventListener('click', onOk); cancelBtn.removeEventListener('click', onCancel); resolve(val); };
    const onOk = ()=>cleanup(true);
    const onCancel = ()=>cleanup(false);
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}
function setConnectionStatus(state){
  // state: 'online' | 'offline' | 'connecting'
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  if(!dot) return;
  dot.className = 'status-dot ' + state;
  label.textContent = state === 'online' ? 'Connecté' : state === 'offline' ? 'Hors ligne' : 'Connexion…';
}

/* ===================== AUTHENTIFICATION ===================== */
async function checkIsAdmin(u){
  if(!u) return false;
  try{
    const snap = await getDoc(doc(db, 'admins', u.uid));
    return snap.exists();
  }catch(e){
    return false;
  }
}

setPersistence(auth, browserLocalPersistence).catch(()=>{});

onAuthStateChanged(auth, async (user)=>{
  if(!user){
    setConnectionStatus('connecting');
    try{ await signInAnonymously(auth); }
    catch(e){ setConnectionStatus('offline'); toast("Connexion impossible. Vérifiez votre réseau.", 'ko'); }
    return;
  }
  currentUser = user;
  isAdmin = await checkIsAdmin(user);
  setConnectionStatus('online');
  updateAuthUI();
  attachLiveListeners();
});

function updateAuthUI(){
  document.querySelectorAll('.admin-gate').forEach(el=> el.classList.toggle('hide', isAdmin));
  document.querySelectorAll('.admin-block, .admin-stack, .admin-bar').forEach(el=> el.classList.toggle('show', isAdmin));
  const emailText = isAdmin && currentUser && !currentUser.isAnonymous ? currentUser.email : '';
  ['admin-email-label', 'admin-email-label-2'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = emailText;
  });
  if(isAdmin){
    renderHistorique(); renderAdmin();
    const histView = document.getElementById('view-historique');
    if(histView && histView.classList.contains('active')) attachPresencesListener();
  } else {
    detachPresencesListener();
  }
}

async function handleAdminLogin(email, password, errEl){
  errEl.textContent = '';
  if(!email || !password){ errEl.textContent = 'Renseignez votre e-mail et votre mot de passe.'; return; }
  try{
    await signInWithEmailAndPassword(auth, email, password);
    const ok = await checkIsAdmin(auth.currentUser);
    if(!ok){
      errEl.textContent = "Ce compte n'a pas les droits administrateur.";
      await signOut(auth);
      return;
    }
    toast('Connecté en tant qu\u2019administrateur.', 'ok');
  }catch(e){
    errEl.textContent = "E-mail ou mot de passe incorrect.";
  }
}
async function handleAdminLogout(){
  await signOut(auth);
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.tab-btn[data-view="pointage"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-pointage').classList.add('active');
  toast('Déconnecté du mode administrateur.', 'ok');
}

/* ===================== ÉCOUTE TEMPS RÉEL ===================== */
// On ré-attache ces écouteurs à chaque changement d'authentification
// (connexion/déconnexion admin) pour éviter qu'ils restent bloqués sur un
// jeton d'authentification expiré.
let agentsUnsub = null, stationsUnsub = null, configUnsub = null;
function attachLiveListeners(){
  if(agentsUnsub) agentsUnsub();
  if(stationsUnsub) stationsUnsub();
  if(configUnsub) configUnsub();

  agentsUnsub = onSnapshot(collection(db, 'agents'), snap=>{
    agents = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderPointageGate();
    drawAgentsList();
  }, ()=>{ /* lecture refusée avant auth prête : ignorer */ });

  stationsUnsub = onSnapshot(collection(db, 'stations'), snap=>{
    stations = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    renderPointageGate();
    drawStationsList();
  }, ()=>{});

  configUnsub = onSnapshot(doc(db, 'config', 'settings'), snap=>{
    if(snap.exists()) config = snap.data();
    configReady = true;
    const input = document.getElementById('radius-input');
    if(input && document.activeElement !== input) input.value = config.radius || 10;
    renderPointageGate();
  }, ()=>{ configReady = true; renderPointageGate(); });
}

function attachPresencesListener(){
  if(presencesUnsub) return;
  presencesUnsub = onSnapshot(
    query(collection(db,'presences'), orderBy('timestamp','desc'), limit(1000)),
    snap=>{
      presences = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      renderHistorique();
    },
    ()=>{ /* pas admin ou hors-ligne */ }
  );
}
function detachPresencesListener(){
  if(presencesUnsub){ presencesUnsub(); presencesUnsub = null; }
}

/* ===================== NAVIGATION ONGLETS ===================== */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    if(btn.dataset.view === 'historique'){
      if(isAdmin){ attachPresencesListener(); renderHistorique(); }
    } else {
      detachPresencesListener();
    }
    if(btn.dataset.view === 'admin') renderAdmin();
    if(btn.dataset.view === 'pointage') renderPointageGate();
  });
});

/* ===================== POINTAGE ===================== */
function renderPointageGate(){
  const gateEmpty = document.getElementById('pointage-empty');
  const searchBlock = document.getElementById('pointage-search-block');
  if(!configReady) return;
  if(!stations.length || !agents.length){
    gateEmpty.style.display = 'block';
    searchBlock.style.display = 'none';
  }else{
    gateEmpty.style.display = 'none';
    searchBlock.style.display = 'block';
  }
}

const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', ()=>{
  const q = normalize(searchInput.value);
  const resultsEl = document.getElementById('search-results');
  resultsEl.innerHTML = '';
  if(!q) return;
  const matches = agents.filter(a=>
    normalize(a.nom+' '+a.prenom).includes(q) || normalize(a.codeId).includes(q)
  ).slice(0, 8);
  if(!matches.length){
    resultsEl.innerHTML = '<p class="muted">Aucun agent ne correspond.</p>';
    return;
  }
  matches.forEach(a=>{
    const div = document.createElement('div');
    div.className = 'agent-item';
    div.innerHTML = `<div class="who"><b>${escapeHtml(a.prenom)} ${escapeHtml(a.nom)}</b><span>${escapeHtml(a.codeId)} · ${escapeHtml(a.superviseur||'—')}</span></div><span class="chev">›</span>`;
    div.addEventListener('click', ()=>selectAgent(a));
    resultsEl.appendChild(div);
  });
});

async function selectAgent(agent){
  selectedAgent = agent;
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('pointage-search-block').style.display = 'none';
  document.getElementById('pointage-result').style.display = 'none';
  document.getElementById('pointage-result').innerHTML = '';

  let statusLine = "Aucun pointage aujourd'hui";
  try{
    const snap = await getDoc(doc(db, 'agentStatus', agent.codeId));
    if(snap.exists()){
      const s = snap.data();
      if(dateKey(s.timestamp) === dateKey(Date.now())){
        statusLine = (s.type === 'entree' ? "Dernière action aujourd'hui : Entrée à " : "Dernière action aujourd'hui : Sortie à ") + fmtTime(s.timestamp);
      }
    }
  }catch(e){}

  const box = document.getElementById('agent-selected');
  box.style.display = 'block';
  box.innerHTML = `
    <div class="badge">
      <div class="badge-top">
        <div>
          <p class="badge-name">${escapeHtml(agent.prenom)} ${escapeHtml(agent.nom)}</p>
          <p class="badge-code">${escapeHtml(agent.codeId)}</p>
        </div>
        <button class="change-link" id="change-agent-btn">changer</button>
      </div>
      <p class="badge-sup">Superviseur : ${escapeHtml(agent.superviseur||'—')}</p>
      <p class="badge-status" id="badge-status-line">${statusLine}</p>
    </div>
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn btn-charge btn-block" id="btn-entree">Marquer l'entrée</button>
      <button class="btn btn-block btn-amber" id="btn-sortie">Marquer la sortie</button>
    </div>
  `;
  document.getElementById('change-agent-btn').addEventListener('click', ()=>{
    selectedAgent = null;
    box.style.display = 'none';
    document.getElementById('pointage-result').style.display = 'none';
    document.getElementById('pointage-search-block').style.display = 'block';
  });
  document.getElementById('btn-entree').addEventListener('click', ()=>doPointage('entree'));
  document.getElementById('btn-sortie').addEventListener('click', ()=>doPointage('sortie'));
}

function doPointage(type){
  if(!('geolocation' in navigator)){
    toast("La géolocalisation n'est pas disponible sur cet appareil.", 'ko');
    return;
  }
  const resultBox = document.getElementById('pointage-result');
  resultBox.style.display = 'block';
  resultBox.innerHTML = `
    <div class="card radar-wrap">
      <div class="radar scanning" id="radar-el">
        <div class="ring"></div><div class="ring"></div><div class="ring"></div>
        <div class="pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg></div>
      </div>
      <div class="result-banner wait" id="result-banner">Recherche de votre position…</div>
    </div>
  `;
  navigator.geolocation.getCurrentPosition(
    pos => handlePosition(pos, type),
    err => handleGeoError(err),
    { enableHighAccuracy:true, timeout:12000, maximumAge:0 }
  );
}

function handleGeoError(err){
  const banner = document.getElementById('result-banner');
  const radar = document.getElementById('radar-el');
  if(radar) radar.classList.remove('scanning');
  let msg = "Impossible d'obtenir votre position.";
  if(err.code === err.PERMISSION_DENIED) msg = "Localisation refusée. Autorisez l'accès à la position pour pointer.";
  else if(err.code === err.POSITION_UNAVAILABLE) msg = "Position indisponible. Vérifiez votre GPS.";
  else if(err.code === err.TIMEOUT) msg = "La recherche de position a expiré. Réessayez.";
  if(banner){ banner.className = 'result-banner ko'; banner.textContent = msg; }
}

async function handlePosition(pos, type){
  const lat = pos.coords.latitude, lon = pos.coords.longitude, acc = pos.coords.accuracy;
  const match = nearestStation(lat, lon);
  const radar = document.getElementById('radar-el');
  const banner = document.getElementById('result-banner');

  if(!match){
    radar.classList.remove('scanning');
    banner.className = 'result-banner ko';
    banner.textContent = "Aucune station enregistrée pour comparer votre position.";
    return;
  }

  const distance = Math.round(match.distance);
  const ok = match.distance <= (config.radius || 10);

  radar.classList.remove('scanning');
  radar.classList.add(ok ? 'ok' : 'ko');
  radar.querySelector('.pin').innerHTML = ok
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  const wrap = document.querySelector('.radar-wrap');
  let distEl = document.getElementById('radar-dist-el');
  if(!distEl){
    distEl = document.createElement('div');
    distEl.id = 'radar-dist-el';
    wrap.insertBefore(distEl, banner);
  }
  distEl.innerHTML = `<div class="radar-dist">${distance}<span> m</span></div><div class="radar-station">de ${escapeHtml(match.station.nom)} · précision GPS ≈ ${Math.round(acc)} m</div>`;

  banner.className = 'result-banner ' + (ok ? 'ok' : 'ko');
  banner.textContent = ok
    ? (type==='entree' ? 'Présence validée — entrée enregistrée' : 'Présence validée — sortie enregistrée')
    : `Échec — hors du rayon de ${config.radius || 10} m`;

  const record = {
    agentCodeId: selectedAgent.codeId,
    agentNom: selectedAgent.nom,
    agentPrenom: selectedAgent.prenom,
    superviseur: selectedAgent.superviseur||'',
    type: type,
    stationNom: match.station.nom,
    lat, lng: lon, accuracy: Math.round(acc),
    distance: Math.round(match.distance),
    statut: ok ? 'valide' : 'echec',
    timestamp: Date.now(),
    createdBy: currentUser ? currentUser.uid : null
  };

  try{
    await addDoc(collection(db, 'presences'), record);
    await setDoc(doc(db, 'agentStatus', selectedAgent.codeId), {
      type, timestamp: record.timestamp, stationNom: match.station.nom
    }, { merge:true });
    const statusLine = document.getElementById('badge-status-line');
    if(statusLine){
      statusLine.textContent = (type==='entree' ? "Dernière action aujourd'hui : Entrée à " : "Dernière action aujourd'hui : Sortie à ") + fmtTime(record.timestamp);
    }
  }catch(e){
    toast("Pointage enregistré localement — il sera synchronisé dès le retour du réseau.", 'ok');
  }
}

/* ===================== HISTORIQUE ===================== */
function renderHistorique(){
  if(!isAdmin) return;
  document.getElementById('stat-total').textContent = presences.length;
  document.getElementById('stat-ok').textContent = presences.filter(p=>p.statut==='valide').length;
  document.getElementById('stat-ko').textContent = presences.filter(p=>p.statut==='echec').length;
  drawHistTable();
}
document.getElementById('filter-hist').addEventListener('input', drawHistTable);

function drawHistTable(){
  const q = normalize(document.getElementById('filter-hist').value);
  const tbody = document.getElementById('hist-tbody');
  const empty = document.getElementById('hist-empty');
  const sorted = [...presences].sort((a,b)=>b.timestamp-a.timestamp);
  const filtered = q ? sorted.filter(p=>
    normalize(p.agentNom+' '+p.agentPrenom).includes(q) ||
    normalize(p.agentCodeId).includes(q) ||
    normalize(p.stationNom).includes(q)
  ) : sorted;

  tbody.innerHTML = '';
  empty.style.display = filtered.length ? 'none' : 'block';
  document.querySelector('.table-wrap').style.display = filtered.length ? 'block' : 'none';

  filtered.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(p.timestamp)}</td>
      <td class="mono">${fmtTime(p.timestamp)}</td>
      <td>${escapeHtml(p.agentPrenom)} ${escapeHtml(p.agentNom)}</td>
      <td class="mono">${escapeHtml(p.agentCodeId)}</td>
      <td>${escapeHtml(p.stationNom)}</td>
      <td><span class="pill ${p.type==='entree'?'in':'out'}">${p.type==='entree'?'ENTRÉE':'SORTIE'}</span></td>
      <td class="mono">${p.distance} m</td>
      <td class="${p.statut==='valide'?'status-ok':'status-ko'}">${p.statut==='valide'?'Validé':'Échec'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function csvEscape(v){
  const s = (v===undefined||v===null) ? '' : String(v);
  if(/[;"\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
function downloadCsv(filename, rows){
  const content = rows.map(r=>r.map(csvEscape).join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF'+content], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('export-detail-btn').addEventListener('click', ()=>{
  if(!presences.length){ toast('Aucun pointage à exporter.', 'ko'); return; }
  const rows = [['Date','Heure','Nom','Prénom','Code ID','Superviseur','Station','Type','Latitude','Longitude','Précision (m)','Distance (m)','Statut']];
  [...presences].sort((a,b)=>a.timestamp-b.timestamp).forEach(p=>{
    rows.push([fmtDate(p.timestamp), fmtTime(p.timestamp), p.agentNom, p.agentPrenom, p.agentCodeId, p.superviseur, p.stationNom, p.type==='entree'?'Entrée':'Sortie', p.lat.toFixed(6), p.lng.toFixed(6), p.accuracy, p.distance, p.statut==='valide'?'Validé':'Échec']);
  });
  downloadCsv('swappoint_pointages_detail.csv', rows);
  toast('Export du détail lancé.', 'ok');
});

document.getElementById('export-summary-btn').addEventListener('click', ()=>{
  const validOnly = presences.filter(p=>p.statut==='valide');
  if(!validOnly.length){ toast('Aucun pointage validé à agréger.', 'ko'); return; }
  const byKey = {};
  validOnly.forEach(p=>{
    const k = p.agentCodeId+'|'+dateKey(p.timestamp);
    if(!byKey[k]) byKey[k] = [];
    byKey[k].push(p);
  });
  const rows = [['Date','Nom','Prénom','Code ID','Superviseur',"Heure d'arrivée","Heure de départ","Durée travaillée","Sessions"]];
  Object.keys(byKey).sort().forEach(k=>{
    const events = byKey[k].sort((a,b)=>a.timestamp-b.timestamp);
    let totalMs = 0, openEntry = null, sessions = 0, firstIn = null, lastOut = null;
    events.forEach(ev=>{
      if(ev.type==='entree'){
        if(firstIn===null) firstIn = ev.timestamp;
        openEntry = ev.timestamp;
      }else if(ev.type==='sortie'){
        lastOut = ev.timestamp;
        if(openEntry!==null){ totalMs += (ev.timestamp - openEntry); sessions++; openEntry = null; }
      }
    });
    const h = Math.floor(totalMs/3600000);
    const m = Math.round((totalMs%3600000)/60000);
    const ref = events[0];
    rows.push([dateKey(ref.timestamp), ref.agentNom, ref.agentPrenom, ref.agentCodeId, ref.superviseur,
      firstIn ? fmtTime(firstIn) : '—', lastOut ? fmtTime(lastOut) : '—',
      (h+'h '+String(m).padStart(2,'0')+'min'), sessions]);
  });
  downloadCsv('swappoint_heures_travaillees.csv', rows);
  toast('Export des heures travaillées lancé.', 'ok');
});

document.getElementById('clear-history-btn').addEventListener('click', async ()=>{
  const yes = await confirmModal("Vider l'historique ?", 'Tous les pointages enregistrés seront définitivement supprimés. Cette action est irréversible.');
  if(!yes) return;
  try{
    const snap = await getDocs(collection(db, 'presences'));
    const docs = snap.docs;
    for(let i=0; i<docs.length; i+=400){
      const batch = writeBatch(db);
      docs.slice(i, i+400).forEach(d=>batch.delete(d.ref));
      await batch.commit();
    }
    toast('Historique vidé.', 'ok');
  }catch(e){
    toast("Échec de la suppression. Vérifiez vos droits d'administrateur.", 'ko');
  }
});

/* ===================== ADMINISTRATION ===================== */
function renderAdmin(){
  if(!isAdmin) return;
  document.getElementById('radius-input').value = config.radius || 10;
  drawAgentsList();
  drawStationsList();
}

document.getElementById('radius-save-btn').addEventListener('click', async ()=>{
  const v = parseFloat(document.getElementById('radius-input').value);
  if(isNaN(v) || v <= 0){ toast('Entrez un rayon valide.', 'ko'); return; }
  try{
    await setDoc(doc(db, 'config', 'settings'), { radius: v }, { merge:true });
    toast('Rayon enregistré : '+v+' m', 'ok');
  }catch(e){ toast("Échec de l'enregistrement.", 'ko'); }
});

function parseDelimited(text){
  return text.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
    const delim = line.includes(';') ? ';' : ',';
    return line.split(delim).map(s=>s.trim());
  });
}

document.getElementById('agents-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{ document.getElementById('agents-input').value = reader.result; };
  reader.readAsText(file, 'UTF-8');
});
document.getElementById('stations-file').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{ document.getElementById('stations-input').value = reader.result; };
  reader.readAsText(file, 'UTF-8');
});

document.getElementById('agents-add-btn').addEventListener('click', async ()=>{
  const raw = document.getElementById('agents-input').value;
  const lines = parseDelimited(raw);
  if(!lines.length){ toast('Rien à importer.', 'ko'); return; }
  let added = 0, updated = 0, invalid = 0;
  for(const cols of lines){
    if(cols.length < 3){ invalid++; continue; }
    const [nom, prenom, codeId, superviseur] = cols;
    if(!codeId){ invalid++; continue; }
    try{
      const ref = doc(db, 'agents', codeId.trim());
      const existed = (await getDoc(ref)).exists();
      await setDoc(ref, { nom: nom||'', prenom: prenom||'', codeId: codeId.trim(), superviseur: superviseur||'' });
      existed ? updated++ : added++;
    }catch(e){ invalid++; }
  }
  document.getElementById('agents-input').value = '';
  toast(`${added} agent(s) ajouté(s), ${updated} mis à jour.` + (invalid?` ${invalid} ligne(s) ignorée(s).`:''), invalid?'ko':'ok');
});

document.getElementById('stations-add-btn').addEventListener('click', async ()=>{
  const raw = document.getElementById('stations-input').value;
  const lines = parseDelimited(raw);
  if(!lines.length){ toast('Rien à importer.', 'ko'); return; }
  let added = 0, updated = 0, invalid = 0;
  for(const cols of lines){
    if(cols.length < 3){ invalid++; continue; }
    const [nom, latS, lngS] = cols;
    const lat = parseFloat(latS), lng = parseFloat(lngS);
    if(!nom || isNaN(lat) || isNaN(lng)){ invalid++; continue; }
    try{
      const ref = doc(db, 'stations', slugify(nom));
      const existed = (await getDoc(ref)).exists();
      await setDoc(ref, { nom: nom.trim(), lat, lng });
      existed ? updated++ : added++;
    }catch(e){ invalid++; }
  }
  document.getElementById('stations-input').value = '';
  toast(`${added} station(s) ajoutée(s), ${updated} mise(s) à jour.` + (invalid?` ${invalid} ligne(s) ignorée(s).`:''), invalid?'ko':'ok');
});

document.getElementById('stations-gps-btn').addEventListener('click', ()=>{
  if(!('geolocation' in navigator)){ toast('Géolocalisation indisponible.', 'ko'); return; }
  toast('Récupération de votre position…', 'ok');
  navigator.geolocation.getCurrentPosition(pos=>{
    const ta = document.getElementById('stations-input');
    const line = `Nouvelle station;${pos.coords.latitude.toFixed(6)};${pos.coords.longitude.toFixed(6)}`;
    ta.value = ta.value ? ta.value + '\n' + line : line;
    toast('Position ajoutée — modifiez le nom de la station puis "Ajouter à la liste".', 'ok');
  }, ()=>{ toast("Impossible d'obtenir la position.", 'ko'); }, {enableHighAccuracy:true, timeout:10000});
});

function drawAgentsList(){
  const list = document.getElementById('agents-list');
  const empty = document.getElementById('agents-empty');
  list.innerHTML = '';
  empty.style.display = agents.length ? 'none' : 'block';
  agents.forEach(a=>{
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<div><div>${escapeHtml(a.prenom)} ${escapeHtml(a.nom)}</div><div class="meta">${escapeHtml(a.codeId)} · ${escapeHtml(a.superviseur||'—')}</div></div>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    delBtn.addEventListener('click', async ()=>{
      const yes = await confirmModal('Supprimer cet agent ?', `${a.prenom} ${a.nom} (${a.codeId}) sera retiré de la liste.`);
      if(!yes) return;
      try{ await deleteDoc(doc(db, 'agents', a.id)); }
      catch(e){ toast('Suppression impossible.', 'ko'); }
    });
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function drawStationsList(){
  const list = document.getElementById('stations-list');
  const empty = document.getElementById('stations-empty');
  list.innerHTML = '';
  empty.style.display = stations.length ? 'none' : 'block';
  stations.forEach(s=>{
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<div><div>${escapeHtml(s.nom)}</div><div class="meta">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</div></div>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    delBtn.addEventListener('click', async ()=>{
      const yes = await confirmModal('Supprimer cette station ?', `${s.nom} sera retirée de la liste.`);
      if(!yes) return;
      try{ await deleteDoc(doc(db, 'stations', s.id)); }
      catch(e){ toast('Suppression impossible.', 'ko'); }
    });
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

/* ===================== FORMULAIRES DE CONNEXION ADMIN ===================== */
function wireLoginForm(prefix){
  const emailEl = document.getElementById(prefix+'-email');
  const passEl = document.getElementById(prefix+'-password');
  const btnEl = document.getElementById(prefix+'-submit');
  const errEl = document.getElementById(prefix+'-error');
  btnEl.addEventListener('click', ()=>handleAdminLogin(emailEl.value.trim(), passEl.value, errEl));
  passEl.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') handleAdminLogin(emailEl.value.trim(), passEl.value, errEl); });
}
wireLoginForm('hist-login');
wireLoginForm('admin-login');
document.querySelectorAll('.logout-btn').forEach(b=>b.addEventListener('click', handleAdminLogout));

/* ===================== ÉTAT RÉSEAU NAVIGATEUR ===================== */
window.addEventListener('offline', ()=>setConnectionStatus('offline'));
window.addEventListener('online', ()=>setConnectionStatus('online'));
