// ----- State & constants -----
let bracketState = null; // [round][match] = { p1, p2, winner }
let roundNamesCache = null;
const STORAGE_KEY = 'tournament_bracket_v3';

// Supabase state (will be initialized from window.supabaseClient)
let supabase;
let currentTournamentId = null;
let currentBracketStateId = null;
let isAdmin = false;
let adminCode = null;
let realtimeSubscription = null;
let pendingWinnerSelection = null; // { roundIndex, matchIndex, slotIndex, playerName }

const playersInput = document.getElementById('playersInput');
const generateBtn = document.getElementById('generateBtn');
const sampleBtn = document.getElementById('sampleBtn');
const clearBtn = document.getElementById('clearBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminStatus = document.getElementById('adminStatus');
const errorEl = document.getElementById('error');
const bracketEl = document.getElementById('bracket');
const bracketEmptyEl = document.getElementById('bracketEmpty');
const bracketWrapper = document.querySelector('.bracket-wrapper');
const mainElement = document.querySelector('main');

// Modal elements
const adminModal = document.getElementById('adminModal');
const adminCodeInput = document.getElementById('adminCodeInput');
const adminSubmitBtn = document.getElementById('adminSubmitBtn');
const adminCancelBtn = document.getElementById('adminCancelBtn');
const adminModalClose = document.getElementById('adminModalClose');
const adminError = document.getElementById('adminError');

const confirmModal = document.getElementById('confirmModal');
const confirmPlayerName = document.getElementById('confirmPlayerName');
const confirmRoundInfo = document.getElementById('confirmRoundInfo');
const confirmSubmitBtn = document.getElementById('confirmSubmitBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmModalClose = document.getElementById('confirmModalClose');

// ----- Helpers -----
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function parsePlayers(raw) {
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

function getRoundNames(roundsCount) {
  const names = [];
  for (let i = 0; i < roundsCount; i++) {
    const remaining = roundsCount - i;
    if (remaining === 1) names.push('Final');
    else if (remaining === 2) names.push('Semi-finals');
    else if (remaining === 3) names.push('Quarter-finals');
    else names.push(`Round ${i + 1}`);
  }
  return names;
}

function saveState() {
  // Save to Supabase instead of localStorage (if admin)
  if (supabase && currentTournamentId && isAdmin) {
    saveToSupabase();
  } else {
    // Fallback to localStorage for non-admin or offline mode
    try {
      const data = { playersText: playersInput.value, bracketState };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Could not save state:', e);
    }
  }
}

async function saveToSupabase() {
  try {
    const data = {
      tournament_id: currentTournamentId,
      players_text: playersInput.value,
      bracket_data: bracketState || [],
      updated_by: adminCode || 'admin'
    };

    if (currentBracketStateId) {
      // Update existing
      const { error } = await supabase
        .from('bracket_state')
        .update(data)
        .eq('id', currentBracketStateId);
      
      if (error) throw error;
    } else {
      // Insert new
      const { data: inserted, error } = await supabase
        .from('bracket_state')
        .insert([data])
        .select()
        .single();
      
      if (error) throw error;
      currentBracketStateId = inserted.id;
    }

    // Log audit trail
    await supabase.from('bracket_audit_log').insert([{
      tournament_id: currentTournamentId,
      action: 'save_state',
      admin_code: adminCode,
      details: { players_count: parsePlayers(playersInput.value).length }
    }]);

  } catch (e) {
    console.error('Supabase save error:', e);
    showError('Failed to sync with server. Changes saved locally.');
  }
}

function loadState() {
  // Try to load from Supabase first, fallback to localStorage
  if (supabase && currentTournamentId) {
    loadFromSupabase();
  } else {
    loadFromLocalStorage();
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.playersText) playersInput.value = parsed.playersText;
    if (parsed.bracketState) { 
      bracketState = parsed.bracketState;
      renderBracket(); 
    }
  } catch (e) {
    console.warn('Could not load state:', e);
  }
}

async function loadFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('bracket_state')
      .select('*')
      .eq('tournament_id', currentTournamentId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    
    if (data) {
      currentBracketStateId = data.id;
      playersInput.value = data.players_text || '';
      bracketState = data.bracket_data || null;
      renderBracket();
    }
  } catch (e) {
    console.error('Supabase load error:', e);
    loadFromLocalStorage(); // Fallback
  }
}

// ----- Bracket creation: only generate rounds that will have real matches -----
function createInitialBracket(players) {
  const numPlayers = players.length;
  const rounds = Math.ceil(Math.log2(Math.max(2, numPlayers)));
  const bracketSize = Math.pow(2, rounds);
  const matchesCount = bracketSize / 2;

  // Shuffle players for random seeding
  const seeded = shuffle([...players]);

  // Interleave assignment: assign players into matches in order
  // so slots are filled as: match0.p1, match0.p2, match1.p1, match1.p2, ...
  // This evens out two-player matches across the round instead of packing them at the start.
  const firstSlots = new Array(matchesCount).fill(null);
  const secondSlots = new Array(matchesCount).fill(null);

  for (let k = 0; k < seeded.length; k++) {
    const matchIndex = Math.floor(k / 2);
    if (matchIndex >= matchesCount) break; // safety
    if (k % 2 === 0) firstSlots[matchIndex] = seeded[k];
    else secondSlots[matchIndex] = seeded[k];
  }

  const firstRoundMatches = [];
  for (let i = 0; i < matchesCount; i++) {
    firstRoundMatches.push({ p1: firstSlots[i] ?? null, p2: secondSlots[i] ?? null, winner: null });
  }

  const bracket = [firstRoundMatches];

  // Subsequent rounds: empty placeholders (waiting) — but only up to the final
  let mc = firstRoundMatches.length;
  for (let r = 1; r < rounds; r++) {
    mc = Math.ceil(mc / 2);
    const roundMatches = [];
    for (let m = 0; m < mc; m++) roundMatches.push({ p1: null, p2: null, winner: null });
    bracket.push(roundMatches);
  }

  return bracket;
}

// Determine which matches are "active" (have players or will receive from active children)
// Returns a matrix of booleans active[roundIndex][matchIndex]
function computeActiveMatrix(bracket) {
  const rounds = bracket.length;
  const active = Array.from({ length: rounds }, () => []);

  // Round 0: active if either slot has a player
  for (let m = 0; m < bracket[0].length; m++) {
    const mm = bracket[0][m];
    active[0][m] = Boolean((mm && (mm.p1 || mm.p2)));
  }

  // Higher rounds: a match is active if it has a player assigned OR at least one child match is active
  for (let r = 1; r < rounds; r++) {
    for (let m = 0; m < bracket[r].length; m++) {
      const mm = bracket[r][m];
      const hasAssigned = Boolean(mm && (mm.p1 || mm.p2));
      // children in previous round are at indices 2*m and 2*m+1
      const child0 = active[r - 1] && active[r - 1][2 * m];
      const child1 = active[r - 1] && active[r - 1][2 * m + 1];
      active[r][m] = hasAssigned || Boolean(child0) || Boolean(child1);
    }
  }

  return active;
}

// Ensure bracket has enough rounds to accommodate `playersCount` in round 0
function ensureRoundsForBracket(playersCount) {
  const currentRounds = bracketState.length;
  const requiredRounds = Math.ceil(Math.log2(Math.max(2, playersCount)));
  if (requiredRounds <= currentRounds) return;

  // Expand rounds by adding empty rounds at the end until we reach requiredRounds
  let lastMatches = bracketState[bracketState.length - 1].length;
  for (let r = currentRounds; r < requiredRounds; r++) {
    lastMatches = Math.ceil(lastMatches / 2);
    const newRound = [];
    for (let m = 0; m < lastMatches; m++) newRound.push({ p1: null, p2: null, winner: null });
    bracketState.push(newRound);
  }
}

// ----- Place a winner into next round (called when a player is clicked) -----
function placeWinner(bracket, roundIndex, matchIndex, playerName) {
  if (!playerName) return;
  const currentMatch = bracket[roundIndex][matchIndex];
  currentMatch.winner = playerName;

  const nextRoundIndex = roundIndex + 1;
  if (nextRoundIndex >= bracket.length) return; // final

  const nextMatchIndex = Math.floor(matchIndex / 2);
  const nextSlotIsTop = (matchIndex % 2 === 0);
  const nextMatch = bracket[nextRoundIndex][nextMatchIndex];

  if (nextSlotIsTop) nextMatch.p1 = playerName;
  else nextMatch.p2 = playerName;
}

// ----- Rendering (optimized with fragment) -----
function renderBracket() {
  if (!bracketState || !bracketState.length) {
    bracketEl.style.display = 'none';
    bracketEmptyEl.style.display = 'flex';
    return;
  }

  // Compute which matches are active and which rounds contain active matches
  const active = computeActiveMatrix(bracketState);
  const roundsCount = bracketState.length;
  const roundsWithActivity = [];
  for (let r = 0; r < roundsCount; r++) {
    const hasActive = active[r].some(Boolean);
    if (hasActive) roundsWithActivity.push(r);
  }

  // If there's nothing active, show empty state
  if (roundsWithActivity.length === 0) {
    bracketEl.style.display = 'none';
    bracketEmptyEl.style.display = 'flex';
    return;
  }

  bracketEmptyEl.style.display = 'none';
  bracketEl.style.display = 'flex';

  // Only render visible rounds
  roundNamesCache = getRoundNames(roundsWithActivity.length);

  // Dynamically set grid columns based on number of visible rounds
  const visibleRoundsCount = roundsWithActivity.length;
  const baseColumnWidth = Math.max(140, Math.min(220, window.innerWidth / (visibleRoundsCount + 1)));
  bracketEl.style.gridTemplateColumns = `repeat(${visibleRoundsCount}, minmax(${baseColumnWidth}px, 1fr))`;

  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();

  // Render only rounds that have active matches
  roundsWithActivity.forEach((rVisibleIndex, colIndex) => {
    const rIndex = rVisibleIndex;
    const roundMatches = bracketState[rIndex];
    const roundCol = document.createElement('div');
    roundCol.className = 'round';

    const title = document.createElement('div');
    title.className = 'round-title';
    // Use cached names based on column index so titles read Final / Semi-finals etc correctly
    title.textContent = roundNamesCache[colIndex] || `Round ${colIndex + 1}`;
    roundCol.appendChild(title);

    roundMatches.forEach((match, mIndex) => {
      // Skip matches that are not active
      if (!active[rIndex][mIndex]) return;
      const isFinal = (rIndex === roundsCount - 1);
      const isSemiFinal = (rIndex === roundsCount - 2);
      const matchDiv = renderMatch(match, rIndex, mIndex, isFinal, isSemiFinal);
      roundCol.appendChild(matchDiv);
    });

    fragment.appendChild(roundCol);
  });

  // Clear and append all at once
  bracketEl.innerHTML = '';
  bracketEl.appendChild(fragment);
}

function renderMatch(match, roundIndex, matchIndex, isFinal, isSemiFinal) {
  const matchDiv = document.createElement('div');
  matchDiv.className = 'match' + (isFinal ? ' final-highlight' : '');

  const body = document.createElement('div');
  body.className = 'match-body';

  // two slots always shown
  ['p1','p2'].forEach((key, sIndex) => {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'slot';

    const playerName = match[key];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'player';

    if (roundIndex === 0) {
      // Round 1: show actual player or BYE placeholder
      if (!playerName) {
        btn.textContent = 'BYE';
        btn.classList.add('bye');
        btn.disabled = true;
      } else {
        btn.textContent = playerName;
        btn.addEventListener('click', () => { 
          handlePlayerClick(roundIndex, matchIndex, sIndex); 
        });
      }
    } else {
      // Round 2+: waiting or assigned when winners are chosen
      if (!playerName) {
        btn.textContent = 'Waiting...';
        btn.classList.add('empty');
        btn.disabled = true;
      } else {
        btn.textContent = playerName;
        btn.addEventListener('click', () => { 
          handlePlayerClick(roundIndex, matchIndex, sIndex); 
        });
      }
    }

    slotDiv.appendChild(btn);

    if (match.winner && playerName && playerName === match.winner) {
      const badge = document.createElement('span');
      badge.className = 'winner-pill';
      badge.textContent = isFinal ? 'Champion' : 'Winner';
      slotDiv.appendChild(badge);
    }

    body.appendChild(slotDiv);
  });

  matchDiv.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'match-footer';
  const label = document.createElement('div');
  label.className = 'match-label';
  label.textContent = `Match ${matchIndex + 1}`;
  footer.appendChild(label);

  // Add "Best of Three" badge for finals and semi-finals
  if (isFinal || isSemiFinal) {
    const bestOfBadge = document.createElement('div');
    bestOfBadge.className = 'best-of-badge';
    bestOfBadge.textContent = 'Best of Three';
    footer.appendChild(bestOfBadge);
  }

  matchDiv.appendChild(footer);
  return matchDiv;
}

// ----- Interaction -----
function handlePlayerClick(roundIndex, matchIndex, slotIndex, isLowerBracket = false) {
  const bracket = bracketState;
  if (!bracket || !bracket[roundIndex]) return;
  
  const match = bracket[roundIndex][matchIndex];
  const playerName = slotIndex === 0 ? match.p1 : match.p2;
  if (!playerName) return;
  if (playerName === 'BYE') return; // defensive: BYE buttons are disabled

  // Admin confirmation required
  if (!isAdmin) {
    showError('Admin login required to advance winners.');
    return;
  }

  // Show confirmation modal
  pendingWinnerSelection = { roundIndex, matchIndex, slotIndex, playerName };
  showConfirmModal(playerName, roundIndex, matchIndex);
}

function showConfirmModal(playerName, roundIndex, matchIndex) {
  confirmPlayerName.textContent = playerName;
  
  const roundNames = getRoundNames(bracketState.length);
  const roundName = roundNames[roundIndex] || `Round ${roundIndex + 1}`;
  confirmRoundInfo.textContent = `${roundName} • Match ${matchIndex + 1}`;
  
  confirmModal.classList.add('active');
}

function hideConfirmModal() {
  confirmModal.classList.remove('active');
  pendingWinnerSelection = null;
}

function confirmWinnerSelection() {
  if (!pendingWinnerSelection) return;
  
  const { roundIndex, matchIndex, slotIndex, playerName } = pendingWinnerSelection;
  const bracket = bracketState;
  
  placeWinner(bracket, roundIndex, matchIndex, playerName);
  renderBracket();
  saveState();
  
  // Log to audit
  if (supabase && currentTournamentId) {
    supabase.from('bracket_audit_log').insert([{
      tournament_id: currentTournamentId,
      action: 'advance_winner',
      admin_code: adminCode,
      details: { 
        round: roundIndex, 
        match: matchIndex, 
        winner: playerName 
      }
    }]);
  }
  
  hideConfirmModal();
}

function generateBracketFromInput() {
  errorEl.textContent = '';
  errorEl.style.color = '#ff6b6b'; // Reset color

  if (!isAdmin) {
    showError('Admin login required to generate or modify tournament.');
    return;
  }

  const players = parsePlayers(playersInput.value);
  if (players.length < 2) { errorEl.textContent = 'You need at least 2 participants.'; return; }
  if (players.length > 128) { errorEl.textContent = 'Max 128 participants supported.'; return; }

  // Check for odd number of players and warn
  if (players.length % 2 !== 0) {
    errorEl.textContent = '⚠️ Warning: Odd number of players detected. Empty slots (BYEs) will appear in later rounds (Quarter-finals or Semi-finals).';
    errorEl.style.color = '#fbbf24'; // warning color
  }

  // If bracket exists, add new players to round 1 instead of resetting
  if (bracketState && bracketState.length > 0) {
    addNewPlayersToRound1(players);
  } else {
    bracketState = createInitialBracket(players);
  }

  renderBracket();
  saveState();
  
  // Log audit
  if (supabase && currentTournamentId) {
    supabase.from('bracket_audit_log').insert([{
      tournament_id: currentTournamentId,
      action: 'generate_bracket',
      admin_code: adminCode,
      details: { players_count: players.length }
    }]);
  }
}

function createLowerBracket() {
  // Lower bracket only has the lower finals (1 match between 2 semi-final losers)
  return [[{ p1: null, p2: null, winner: null }]];
}

function addNewPlayersToRound1(allPlayers) {
  // Get current players in round 1
  const currentRound1Players = bracketState[0]
    .flatMap(match => [match.p1, match.p2])
    .filter(p => p !== null && p !== 'BYE');

  // Find new players not in bracket
  const newPlayers = allPlayers.filter(p => !currentRound1Players.includes(p));

  if (newPlayers.length === 0) {
    errorEl.textContent = 'No new players to add.';
    return;
  }

  // Shuffle new players for randomness
  shuffle(newPlayers);

  // Add new players to empty slots or create new matches
  let newPlayerIdx = 0;

  // First pass: fill empty slots in existing matches
  for (let i = 0; i < bracketState[0].length && newPlayerIdx < newPlayers.length; i++) {
    const match = bracketState[0][i];
    if (!match.p1) match.p1 = newPlayers[newPlayerIdx++];
    if (!match.p2 && newPlayerIdx < newPlayers.length) match.p2 = newPlayers[newPlayerIdx++];
  }

  // Second pass: if still more new players, create new matches
  if (newPlayerIdx < newPlayers.length) {
    const newMatches = [];
    while (newPlayerIdx < newPlayers.length) {
      const p1 = newPlayers[newPlayerIdx++];
      const p2 = newPlayerIdx < newPlayers.length ? newPlayers[newPlayerIdx++] : null;
      newMatches.push({ p1, p2, winner: null });
    }

    // Add new matches to round 1
    bracketState[0] = bracketState[0].concat(newMatches);
  }

  // After adding players/matches, ensure we have enough rounds for the total players in round 1
  const totalPlayersInRound1 = bracketState[0].flatMap(m => [m.p1, m.p2]).filter(Boolean).length;
  ensureRoundsForBracket(totalPlayersInRound1);
}

function fillSampleNames() {
  const sample = [];
  for (let i = 1; i <= 8; i++) sample.push('Participant ' + i);
  playersInput.value = sample.join('\n');
  errorEl.textContent = '';
}

function clearBracket() {
  if (!isAdmin) {
    showError('Admin login required to clear the tournament.');
    return;
  }
  
  if (!confirm('Clear bracket and saved data? This cannot be undone.')) return;
  
  bracketState = null;
  playersInput.value = '';
  errorEl.textContent = '';
  errorEl.style.color = '#ff6b6b'; // reset to error color
  renderBracket();
  saveState();
  
  // Log audit
  if (supabase && currentTournamentId) {
    supabase.from('bracket_audit_log').insert([{
      tournament_id: currentTournamentId,
      action: 'clear_bracket',
      admin_code: adminCode,
      details: {}
    }]);
  }
}

// ----- Wiring & init -----
generateBtn.addEventListener('click', generateBracketFromInput);
sampleBtn.addEventListener('click', fillSampleNames);
clearBtn.addEventListener('click', clearBracket);

// Admin modal handlers
adminLoginBtn.addEventListener('click', showAdminModal);
adminModalClose.addEventListener('click', hideAdminModal);
adminCancelBtn.addEventListener('click', hideAdminModal);
adminSubmitBtn.addEventListener('click', handleAdminLogin);
adminCodeInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleAdminLogin();
});

// Confirmation modal handlers
confirmModalClose.addEventListener('click', hideConfirmModal);
confirmCancelBtn.addEventListener('click', hideConfirmModal);
confirmSubmitBtn.addEventListener('click', confirmWinnerSelection);

// Close modals when clicking outside
adminModal.addEventListener('click', (e) => {
  if (e.target === adminModal) hideAdminModal();
});
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) hideConfirmModal();
});

// ----- Admin Authentication -----
function showAdminModal() {
  console.log('showAdminModal called, isAdmin:', isAdmin);
  console.log('adminModal element:', adminModal);
  
  if (isAdmin) {
    // Already logged in - show logout option
    if (confirm('You are logged in as admin. Do you want to logout?')) {
      logout();
    }
    return;
  }
  
  if (!adminModal) {
    console.error('adminModal element not found!');
    return;
  }
  
  console.log('Adding active class to modal');
  adminModal.classList.add('active');
  adminCodeInput.value = '';
  adminError.textContent = '';
  setTimeout(() => adminCodeInput.focus(), 100);
  console.log('Modal should be visible now, classes:', adminModal.className);
}

function hideAdminModal() {
  adminModal.classList.remove('active');
  adminError.textContent = '';
}

async function handleAdminLogin() {
  const code = adminCodeInput.value.trim();
  if (!code) {
    adminError.textContent = 'Please enter an admin code.';
    return;
  }

  adminSubmitBtn.disabled = true;
  adminSubmitBtn.textContent = 'Verifying...';

  try {
    // Verify code against Supabase
    const { data, error } = await supabase
      .from('admin_codes')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      adminError.textContent = 'Invalid admin code. Please try again.';
      adminSubmitBtn.disabled = false;
      adminSubmitBtn.textContent = 'Login';
      return;
    }

    // Update last used timestamp
    await supabase
      .from('admin_codes')
      .update({ last_used_at: new Date().toISOString() })
      .eq('code', code);

    // Set admin state
    isAdmin = true;
    adminCode = code;
    sessionStorage.setItem('admin_code', code);
    
    updateAdminUI();
    hideAdminModal();
    
    adminSubmitBtn.disabled = false;
    adminSubmitBtn.textContent = 'Login';

  } catch (e) {
    console.error('Admin login error:', e);
    adminError.textContent = 'Login failed. Please try again.';
    adminSubmitBtn.disabled = false;
    adminSubmitBtn.textContent = 'Login';
  }
}

function logout() {
  isAdmin = false;
  adminCode = null;
  sessionStorage.removeItem('admin_code');
  updateAdminUI();
}

function updateAdminUI() {
  if (isAdmin) {
    adminLoginBtn.textContent = '🔓 Admin Mode';
    adminLoginBtn.classList.add('admin-active');
    adminStatus.textContent = '✓ Admin';
    adminStatus.classList.add('active');
    
    // Enable controls
    playersInput.disabled = false;
    generateBtn.disabled = false;
    clearBtn.disabled = false;
  } else {
    adminLoginBtn.textContent = '🔐 Admin Login';
    adminLoginBtn.classList.remove('admin-active');
    adminStatus.textContent = '';
    adminStatus.classList.remove('active');
    
    // Disable controls for non-admins
    playersInput.disabled = true;
    generateBtn.disabled = true;
    clearBtn.disabled = true;
  }
}

// ----- Supabase Realtime Subscription -----
async function setupRealtimeSubscription() {
  if (!supabase || !currentTournamentId) return;

  // Subscribe to changes in bracket_state table
  realtimeSubscription = supabase
    .channel('bracket_changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bracket_state',
        filter: `tournament_id=eq.${currentTournamentId}`
      },
      (payload) => {
        console.log('Realtime update received:', payload);
        
        // Only reload if change came from another source
        if (payload.new && payload.new.id !== currentBracketStateId) {
          loadFromSupabase();
        } else if (payload.new) {
          // Same bracket ID but updated - refresh
          playersInput.value = payload.new.players_text || '';
          bracketState = payload.new.bracket_data || null;
          renderBracket();
        }
      }
    )
    .subscribe();
}

// ----- Supabase Initialization -----
async function initializeSupabase() {
  try {
    // Get supabase client from config (created in supabase-config.js)
    supabase = window.supabaseClient || null;
    
    if (!supabase) {
      console.warn('Supabase not configured. Running in offline mode.');
      loadFromLocalStorage();
      return;
    }

    // Get or create tournament
    const { data: tournaments, error: tourError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('is_active', true)
      .limit(1);

    if (tourError) throw tourError;

    if (tournaments && tournaments.length > 0) {
      currentTournamentId = tournaments[0].id;
    } else {
      // Create default tournament
      const { data: newTour, error: createError } = await supabase
        .from('tournaments')
        .insert([{ name: 'Anime Night Tournament', is_active: true }])
        .select()
        .single();
      
      if (createError) throw createError;
      currentTournamentId = newTour.id;
    }

    // Check if admin was previously logged in (session)
    const savedAdminCode = sessionStorage.getItem('admin_code');
    if (savedAdminCode) {
      const { data } = await supabase
        .from('admin_codes')
        .select('*')
        .eq('code', savedAdminCode)
        .eq('is_active', true)
        .single();
      
      if (data) {
        isAdmin = true;
        adminCode = savedAdminCode;
        updateAdminUI();
      }
    }

    // Load bracket state
    await loadFromSupabase();
    
    // Setup realtime subscription
    await setupRealtimeSubscription();

  } catch (e) {
    console.error('Supabase initialization error:', e);
    console.warn('Falling back to offline mode.');
    loadFromLocalStorage();
  }
}

// Helper function to show errors
function showError(message) {
  errorEl.textContent = message;
  errorEl.style.color = '#ff6b6b';
}

fullscreenBtn.addEventListener('click', () => {
  const isFullscreen = bracketWrapper.classList.contains('fullscreen-mode');
  
  if (!isFullscreen) {
    // Enter fullscreen
    bracketWrapper.classList.add('fullscreen-mode');
    bracketEl.classList.add('fullscreen');
    document.body.classList.add('fullscreen-active');
    fullscreenBtn.textContent = '⛶ Exit Fullscreen';
    fullscreenBtn.classList.add('active');
    
    // Try to use Fullscreen API if available
    if (bracketWrapper.requestFullscreen) {
      bracketWrapper.requestFullscreen().catch(err => {
        console.log('Fullscreen request failed:', err);
      });
    }
  } else {
    // Exit fullscreen
    bracketWrapper.classList.remove('fullscreen-mode');
    bracketEl.classList.remove('fullscreen');
    document.body.classList.remove('fullscreen-active');
    fullscreenBtn.textContent = '⛶ Fullscreen';
    fullscreenBtn.classList.remove('active');
    
    // Exit Fullscreen API if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(err => {
        console.log('Exit fullscreen failed:', err);
      });
    }
  }
  // Re-render to adjust grid on fullscreen toggle
  if (bracketState) renderBracket();
});

// Re-render bracket when window is resized to adjust columns dynamically
window.addEventListener('resize', () => {
  if (bracketState) renderBracket();
});

// Initialize app
(async function init() {
  console.log('=== Tournament App Initializing ===');
  console.log('DOM elements check:');
  console.log('- adminLoginBtn:', adminLoginBtn);
  console.log('- adminModal:', adminModal);
  console.log('- adminCodeInput:', adminCodeInput);
  
  await initializeSupabase();
  updateAdminUI(); // Set initial UI state
  
  // Load sample data if nothing exists and not admin
  if (!bracketState && !playersInput.value.trim() && !isAdmin) {
    fillSampleNames();
  }
  
  console.log('=== Initialization Complete ===');
  console.log('- isAdmin:', isAdmin);
  console.log('- supabase:', supabase ? 'Connected' : 'Not connected');
})();
