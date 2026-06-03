'use strict';

const PET_BASE = '/lib/icons/Claude_code_pet/';
const PET_GIFS = {
  idle:     'clyde-idle-living.svg',
  happy:    'clawd-happy.gif',
  building: 'clawd-building.gif',
  sleeping: 'clawd-sleeping.gif',
  thinking: 'clawd-thinking.gif',
  drag:     'clyde-react-drag.svg',
  error:    'clyde-error.svg',
};

const PET_SIZE    = 110;
const WALK_SPEED  = 55;
const SLEEP_AFTER = 45000;

const rand = (min, max) => Math.random() * (max - min) + min;

let petEl, imgEl;
let posX = 0;
let dir = 1;
let state = 'idle';
let isWalking = true;
let zone = { min: 0, max: 0 };
let wanderTimer  = null;
let sleepTimer   = null;
let rafId        = null;
let lastTs       = null;
let isDragging   = false;
let dragOffsetX  = 0;
let dragOffsetY  = 0;
let preDrawState = 'idle';

// ─── 초기화 ───────────────────────────────────────────────────────────────────

function initPet() {
  petEl = document.getElementById('pet');
  imgEl = document.getElementById('pet-img');
  if (!petEl || !imgEl) return;

  petEl.addEventListener('click', onPetClick);
  petEl.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  document.addEventListener('pet:thinking', () => transitionTo('thinking'));
  document.addEventListener('pet:building', () => transitionTo('building'));
  document.addEventListener('pet:happy', () => {
    transitionTo('happy');
    setTimeout(() => { if (state === 'happy') transitionTo('idle'); }, 3000);
  });
  document.addEventListener('pet:error', () => {
    transitionTo('error');
    setTimeout(() => { if (state === 'error') transitionTo('idle'); }, 4000);
  });

  ['click', 'keydown', 'mousemove'].forEach(ev =>
    document.addEventListener(ev, resetSleepTimer, { passive: true })
  );

  window.addEventListener('resize', () => { updateZone(); positionMenu(); });

  updateZone();
  transitionTo('idle');
  scheduleWander();
  resetSleepTimer();
}

// ─── 여백 구간 계산 ───────────────────────────────────────────────────────────

function updateZone() {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  const rect = appEl.getBoundingClientRect();

  const leftW  = rect.left - PET_SIZE - 10;
  const rightW = window.innerWidth - rect.right - PET_SIZE - 10;

  // 여유 공간이 있는 쪽 선택, 둘 다 있으면 더 넓은 쪽
  if (rightW >= 10 && rightW >= leftW) {
    zone = { min: rect.right + 5, max: window.innerWidth - PET_SIZE - 5 };
  } else if (leftW >= 10) {
    zone = { min: 5, max: rect.left - PET_SIZE - 5 };
  } else {
    // 창이 좁아서 여백 없음 → 하단 고정 우측 코너
    zone = { min: window.innerWidth - PET_SIZE - 10, max: window.innerWidth - PET_SIZE - 10 };
  }

  // 현재 위치가 구간 밖이면 구간 안으로 이동
  posX = Math.max(zone.min, Math.min(posX || zone.min, zone.max));
  if (petEl) petEl.style.left = posX + 'px';
}

// ─── 상태 전환 ────────────────────────────────────────────────────────────────

function transitionTo(next) {
  if (state === next) return;
  state = next;
  imgEl.src = PET_BASE + PET_GIFS[next];

  if (next === 'idle') {
    startWalk();
    scheduleWander();
  } else {
    stopWalk();
    clearTimeout(wanderTimer);
    if (next === 'sleeping') closeMenu();
  }
}

// ─── 랜덤 걷기/멈춤 ──────────────────────────────────────────────────────────

function scheduleWander() {
  clearTimeout(wanderTimer);
  if (state !== 'idle') return;

  if (isWalking) {
    wanderTimer = setTimeout(() => {
      isWalking = false;
      scheduleWander();
    }, rand(1500, 4000));
  } else {
    wanderTimer = setTimeout(() => {
      if (Math.random() < 0.4) dir *= -1;
      isWalking = true;
      startWalk();
      scheduleWander();
    }, rand(800, 2500));
  }
}

// ─── 클릭 ─────────────────────────────────────────────────────────────────────

const PET_MENU_ITEMS = [
  { label: '🔍 노트 검색',   command: '/search ',    autoSend: false },
  { label: '🧠 메모리 보기', command: '/memory',      autoSend: true  },
  { label: '🗂 정리 상태',   command: '/organize',    autoSend: true  },
  { label: '🧹 정리',        command: '/organize process', autoSend: true },
  { label: '🔁 전체 재정리', command: '/organize all', autoSend: true },
  { label: '➕ 메모리 추가', command: '/memory add ', autoSend: false },
];

let menuEl = null;

function onPetClick(e) {
  e.stopPropagation();
  resetSleepTimer();

  if (state === 'sleeping') {
    isWalking = true;
    transitionTo('idle');
    return;
  }

  if (menuEl) { closeMenu(); return; }
  openMenu();
}

const CLICK_REACTIONS = ['happy', 'thinking', 'building'];

function openMenu() {
  const reaction = CLICK_REACTIONS[Math.floor(Math.random() * CLICK_REACTIONS.length)];
  transitionTo(reaction);
  menuEl = document.createElement('div');
  menuEl.id = 'pet-menu';

  PET_MENU_ITEMS.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'pet-menu-item';
    btn.textContent = item.label;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      closeMenu();
      runCommand(item.command, item.autoSend);
    });
    menuEl.appendChild(btn);
  });

  document.body.appendChild(menuEl);
  positionMenu();
  setTimeout(() => document.addEventListener('click', closeMenuOnOutside), 0);
}

function positionMenu() {
  if (!menuEl) return;
  const petRect = petEl.getBoundingClientRect();
  const menuW = 160;
  let left = petRect.left + petRect.width / 2 - menuW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
  menuEl.style.left = left + 'px';
  menuEl.style.bottom = (window.innerHeight - petRect.top + 8) + 'px';
}

function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  document.removeEventListener('click', closeMenuOnOutside);
  if (CLICK_REACTIONS.includes(state)) transitionTo('idle');
}

function closeMenuOnOutside() { closeMenu(); }

function runCommand(command, autoSend) {
  const input = document.getElementById('input');
  if (!input) return;
  input.value = command;
  input.focus();
  input.dispatchEvent(new Event('input'));
  if (autoSend) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
}

// ─── 드래그 ───────────────────────────────────────────────────────────────────

function onDragStart(e) {
  if (e.button !== 0) return;
  isDragging = true;
  preDrawState = state;
  dragOffsetX = e.clientX - petEl.getBoundingClientRect().left;
  dragOffsetY = e.clientY - petEl.getBoundingClientRect().top;

  // fixed bottom → fixed top 전환
  const rect = petEl.getBoundingClientRect();
  petEl.style.top    = rect.top + 'px';
  petEl.style.bottom = 'auto';

  stopWalk();
  clearTimeout(wanderTimer);
  imgEl.src = PET_BASE + PET_GIFS.drag;
  imgEl.style.transform = '';
  petEl.style.cursor = 'grabbing';
  e.preventDefault();
}

function onDragMove(e) {
  if (!isDragging) return;
  const x = e.clientX - dragOffsetX;
  const y = e.clientY - dragOffsetY;
  petEl.style.left = Math.max(0, Math.min(x, window.innerWidth - PET_SIZE)) + 'px';
  petEl.style.top  = Math.max(0, Math.min(y, window.innerHeight - PET_SIZE)) + 'px';
  positionMenu();
}

function onDragEnd(e) {
  if (!isDragging) return;
  isDragging = false;
  petEl.style.cursor = 'pointer';

  // top 위치를 bottom으로 재변환
  const rect = petEl.getBoundingClientRect();
  posX = Math.max(zone.min, Math.min(rect.left, zone.max));
  petEl.style.left   = posX + 'px';
  petEl.style.top    = 'auto';
  petEl.style.bottom = '72px';

  // 드랍 후 상태 복귀
  state = 'happy'; // transitionTo 가 skip 안 하도록
  transitionTo('happy');
  setTimeout(() => { if (state === 'happy') transitionTo('idle'); }, 2000);
}

// ─── 걷기 ─────────────────────────────────────────────────────────────────────

function startWalk() {
  if (rafId) return;
  lastTs = null;
  rafId = requestAnimationFrame(walkStep);
}

function stopWalk() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function walkStep(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.1);
  lastTs = ts;

  if (isWalking && state === 'idle') {
    posX += dir * WALK_SPEED * dt;

    if (posX >= zone.max) { posX = zone.max; dir = -1; }
    if (posX <= zone.min) { posX = zone.min; dir =  1; }

    petEl.style.left = posX + 'px';
    imgEl.style.transform = dir === -1 ? 'scaleX(-1)' : '';
  }

  rafId = requestAnimationFrame(walkStep);
}

// ─── 슬리프 타이머 ───────────────────────────────────────────────────────────

function resetSleepTimer() {
  clearTimeout(sleepTimer);
  if (state === 'sleeping') {
    isWalking = true;
    transitionTo('idle');
  }
  sleepTimer = setTimeout(() => transitionTo('sleeping'), SLEEP_AFTER);
}
