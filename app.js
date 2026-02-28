/**
 * TaskFlow — Offline-first Task Manager
 * Pure JS, localStorage persistence, no dependencies
 */

'use strict';

/* ═══════════════════════════════════════════
   STORAGE LAYER
═══════════════════════════════════════════ */
const Storage = {
  TASKS_KEY: 'tf_tasks',
  SETTINGS_KEY: 'tf_settings',

  getTasks() {
    try {
      return JSON.parse(localStorage.getItem(this.TASKS_KEY) || '[]');
    } catch { return []; }
  },
  saveTasks(tasks) {
    localStorage.setItem(this.TASKS_KEY, JSON.stringify(tasks));
  },
  getSettings() {
    const defaults = {
      theme: 'dark',
      accent: 'indigo',
      density: 'comfortable',
      defaultSort: 'custom',
      defaultView: 'today',
      notifications: false,
      reminderMinutes: 15,
    };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(this.SETTINGS_KEY) || '{}') };
    } catch { return defaults; }
  },
  saveSettings(s) {
    localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(s));
  },
  getUsage() {
    let bytes = 0;
    for (const k in localStorage) {
      if (!localStorage.hasOwnProperty(k)) continue;
      bytes += (localStorage[k].length + k.length) * 2;
    }
    return bytes;
  }
};

/* ═══════════════════════════════════════════
   TASK MODEL
═══════════════════════════════════════════ */
function createTask(data = {}) {
  return {
    id: data.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: data.title || '',
    description: data.description || '',
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dueAt: data.dueAt || null,
    completedAt: data.completedAt || null,
    priority: data.priority || 'medium',
    tags: data.tags || [],
    subtasks: data.subtasks || [],
    order: data.order != null ? data.order : Date.now(),
    starred: data.starred || false,
    reminderAt: data.reminderAt || null,
    metadata: data.metadata || {}
  };
}

/* ═══════════════════════════════════════════
   NATURAL LANGUAGE PARSER
═══════════════════════════════════════════ */
function parseNLP(text) {
  const result = { title: text, dueAt: null, priority: 'medium', tags: [] };

  // Priority: !high !med !low
  text = text.replace(/!high/gi, () => { result.priority = 'high'; return ''; });
  text = text.replace(/!med(ium)?/gi, () => { result.priority = 'medium'; return ''; });
  text = text.replace(/!low/gi, () => { result.priority = 'low'; return ''; });

  // Tags: #word
  text = text.replace(/#(\w+)/g, (_, tag) => { result.tags.push(tag); return ''; });

  // Date patterns
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);

  if (/\btoday\b/i.test(text)) {
    result.dueAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59).toISOString();
    text = text.replace(/\btoday\b/gi, '');
  } else if (/\btomorrow\b/i.test(text)) {
    result.dueAt = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0).toISOString();
    text = text.replace(/\btomorrow\b/gi, '');
  } else if (/\bnext week\b/i.test(text)) {
    const nw = new Date(now); nw.setDate(now.getDate() + 7);
    result.dueAt = nw.toISOString();
    text = text.replace(/\bnext week\b/gi, '');
  }

  // Time: 9am, 2:30pm
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch && result.dueAt) {
    const d = new Date(result.dueAt);
    let h = parseInt(timeMatch[1]);
    const m = parseInt(timeMatch[2] || '0');
    const meridiem = timeMatch[3].toLowerCase();
    if (meridiem === 'pm' && h !== 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    d.setHours(h, m, 0, 0);
    result.dueAt = d.toISOString();
    text = text.replace(timeMatch[0], '');
  }

  result.title = text.replace(/\s{2,}/g, ' ').trim();
  return result;
}

/* ═══════════════════════════════════════════
   APP STATE
═══════════════════════════════════════════ */
const state = {
  tasks: [],
  settings: {},
  currentView: 'today',
  searchQuery: '',
  sortBy: 'custom',
  filterPriorities: [],
  filterDue: '',
  selectedIds: new Set(),
  dragSrcId: null,
  editingTaskId: null,
  modalPriority: 'medium',
  modalStarred: false,
  modalSubtasks: [],
};

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
function init() {
  state.tasks = Storage.getTasks();
  state.settings = Storage.getSettings();
  state.currentView = state.settings.defaultView || 'today';
  state.sortBy = state.settings.defaultSort || 'custom';

  applySettings(state.settings);
  setupEventListeners();
  renderAll();
  updateOnlineStatus();
  setupNetworkListeners();
  updateBadges();
  updateStorageInfo();

  // Show keyboard shortcuts on ?
  document.addEventListener('keydown', handleGlobalKeys);
}

/* ═══════════════════════════════════════════
   SETTINGS APPLICATION
═══════════════════════════════════════════ */
function applySettings(s) {
  document.documentElement.setAttribute('data-theme', s.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : s.theme
  );
  document.documentElement.setAttribute('data-accent', s.accent || 'indigo');
  document.documentElement.setAttribute('data-density', s.density || 'comfortable');

  // Sync UI controls
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.t === s.theme));
  document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('active', b.dataset.accent === s.accent));
  document.querySelectorAll('.density-opt').forEach(b => b.classList.toggle('active', b.dataset.density === s.density));
  const dss = document.getElementById('default-sort-setting');
  const dvs = document.getElementById('default-view-setting');
  if (dss) dss.value = s.defaultSort || 'custom';
  if (dvs) dvs.value = s.defaultView || 'today';
  const nt = document.getElementById('notif-toggle');
  if (nt) nt.checked = s.notifications;
  const rt = document.getElementById('reminder-time');
  if (rt) rt.value = s.reminderMinutes;
}

/* ═══════════════════════════════════════════
   VIEW NAVIGATION
═══════════════════════════════════════════ */
function navigateTo(view) {
  state.currentView = view;
  state.selectedIds.clear();

  // Toggle sections
  document.getElementById('view-tasks').classList.toggle('active', view !== 'settings');
  document.getElementById('view-tasks').hidden = view === 'settings';
  document.getElementById('view-settings').hidden = view !== 'settings';
  document.getElementById('view-settings').classList.toggle('active', view === 'settings');

  // Update nav active states
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
    if (el.dataset.view === view) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });

  // Update page title
  const titles = { today: 'Today', upcoming: 'Upcoming', all: 'All Tasks', starred: 'Starred', completed: 'Completed', settings: 'Settings' };
  document.getElementById('page-title').textContent = titles[view] || 'Tasks';

  // FAB visibility
  const fab = document.getElementById('fab-desktop');
  if (fab) fab.classList.toggle('hidden', view === 'settings');

  if (view !== 'settings') renderTaskList();
  if (view === 'settings') updateStorageInfo();

  // Close mobile sidebar
  closeMobileSidebar();
}

/* ═══════════════════════════════════════════
   FILTER & SORT TASKS
═══════════════════════════════════════════ */
function getFilteredTasks() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayStart.getDate() + 1);
  const weekEnd = new Date(todayStart); weekEnd.setDate(todayStart.getDate() + 7);

  let tasks = [...state.tasks];

  // View filter
  if (state.currentView === 'today') {
    tasks = tasks.filter(t => {
      if (t.completedAt) return false;
      if (!t.dueAt) return false;
      const d = new Date(t.dueAt);
      return d >= todayStart && d < todayEnd;
    });
  } else if (state.currentView === 'upcoming') {
    tasks = tasks.filter(t => {
      if (t.completedAt) return false;
      if (!t.dueAt) return false;
      const d = new Date(t.dueAt);
      return d >= todayEnd && d < weekEnd;
    });
  } else if (state.currentView === 'all') {
    tasks = tasks.filter(t => !t.completedAt);
  } else if (state.currentView === 'starred') {
    tasks = tasks.filter(t => t.starred && !t.completedAt);
  } else if (state.currentView === 'completed') {
    tasks = tasks.filter(t => !!t.completedAt);
  }

  // Tag filter (from sidebar nav tag click)
  if (state.filterTag) {
    tasks = tasks.filter(t => t.tags.includes(state.filterTag));
  }

  // Priority filter
  if (state.filterPriorities.length > 0) {
    tasks = tasks.filter(t => state.filterPriorities.includes(t.priority));
  }

  // Due date filter
  if (state.filterDue === 'today') {
    tasks = tasks.filter(t => t.dueAt && new Date(t.dueAt) >= todayStart && new Date(t.dueAt) < todayEnd);
  } else if (state.filterDue === 'week') {
    tasks = tasks.filter(t => t.dueAt && new Date(t.dueAt) >= todayStart && new Date(t.dueAt) < weekEnd);
  } else if (state.filterDue === 'overdue') {
    tasks = tasks.filter(t => t.dueAt && new Date(t.dueAt) < now && !t.completedAt);
  }

  // Search
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some(tag => tag.toLowerCase().includes(q))
    );
  }

  // Sort
  const sort = state.sortBy;
  tasks.sort((a, b) => {
    if (sort === 'dueDate') {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt) - new Date(b.dueAt);
    }
    if (sort === 'priority') {
      const map = { high: 0, medium: 1, low: 2 };
      return map[a.priority] - map[b.priority];
    }
    if (sort === 'created') return new Date(b.createdAt) - new Date(a.createdAt);
    if (sort === 'alpha') return a.title.localeCompare(b.title);
    return a.order - b.order;
  });

  return tasks;
}

/* ═══════════════════════════════════════════
   RENDER
═══════════════════════════════════════════ */
function renderAll() {
  renderTaskList();
  renderTagsNav();
  updateBadges();
}

function renderTaskList() {
  const tasks = getFilteredTasks();
  const list = document.getElementById('task-list');
  const empty = document.getElementById('empty-state');

  if (tasks.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    setEmptyState();
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = tasks.map(renderTaskCard).join('');

  // Bind task events
  list.querySelectorAll('.task-card').forEach(card => {
    const id = card.dataset.id;
    const cbx = card.querySelector('.task-checkbox input');

    // Checkbox
    cbx.addEventListener('change', () => toggleComplete(id));

    // Click to edit (not on checkbox/more)
    card.addEventListener('click', e => {
      if (e.target.closest('.task-checkbox') || e.target.closest('.task-more-btn') || e.target.closest('.drag-handle')) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleSelect(id);
      } else {
        openEditModal(id);
      }
    });

    // More button
    const moreBtn = card.querySelector('.task-more-btn');
    moreBtn.addEventListener('click', e => {
      e.stopPropagation();
      showContextMenu(e, id);
    });

    // Drag & drop
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', e => {
      state.dragSrcId = id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (state.dragSrcId && state.dragSrcId !== id) reorderTasks(state.dragSrcId, id);
    });

    // Selected state
    if (state.selectedIds.has(id)) card.classList.add('selected');
  });

  updateBulkBar();
}

function renderTaskCard(task) {
  const now = new Date();
  const isOverdue = task.dueAt && new Date(task.dueAt) < now && !task.completedAt;
  const completedSubtasks = task.subtasks.filter(s => s.done).length;
  const totalSubtasks = task.subtasks.length;
  const progressPct = totalSubtasks ? Math.round(completedSubtasks / totalSubtasks * 100) : 0;

  return `
  <div class="task-card${task.completedAt ? ' completed' : ''}${isOverdue ? ' overdue' : ''}"
       data-id="${task.id}"
       data-priority="${task.priority}"
       role="listitem"
       aria-label="${escHtml(task.title)}, priority ${task.priority}${task.completedAt ? ', completed' : ''}">
    <div class="task-checkbox">
      <input type="checkbox" ${task.completedAt ? 'checked' : ''} aria-label="Complete ${escHtml(task.title)}" />
      <div class="task-checkbox-visual" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
    </div>
    <div class="task-body">
      <div class="task-title">${escHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc-preview">${escHtml(task.description.slice(0, 80))}</div>` : ''}
      <div class="task-meta">
        ${task.dueAt ? `<span class="task-due">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          ${formatDate(task.dueAt)}
        </span>` : ''}
        ${task.tags.map(t => `<span class="task-tag">#${escHtml(t)}</span>`).join('')}
        ${task.starred ? `<span class="task-star-indicator" title="Starred">★</span>` : ''}
        ${totalSubtasks > 0 ? `
          <div class="subtask-progress">
            <div class="progress-bar"><div class="progress-fill" style="width:${progressPct}%"></div></div>
            <span>${completedSubtasks}/${totalSubtasks}</span>
          </div>
        ` : ''}
      </div>
    </div>
    <div class="task-actions">
      <div class="drag-handle" aria-hidden="true" title="Drag to reorder">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
      </div>
      <button class="task-more-btn" aria-label="More options for ${escHtml(task.title)}">⋯</button>
    </div>
  </div>`;
}

function setEmptyState() {
  const titles = {
    today: { title: 'All clear for today!', desc: 'No tasks due today. Enjoy your free time or add something.', cta: 'Add Today\'s Task' },
    upcoming: { title: 'Nothing upcoming', desc: 'Schedule your future tasks to stay ahead.', cta: 'Plan Ahead' },
    all: { title: 'No tasks yet', desc: 'Start fresh. Press N or click below to add your first task.', cta: 'Add a Task' },
    starred: { title: 'No starred tasks', desc: 'Star important tasks to find them here quickly.', cta: 'Browse All Tasks' },
    completed: { title: 'Nothing completed yet', desc: 'Complete some tasks and they\'ll appear here.', cta: 'View All Tasks' },
  };
  const s = titles[state.currentView] || titles.all;

  if (state.searchQuery) {
    document.getElementById('empty-title').textContent = 'No results found';
    document.getElementById('empty-desc').innerHTML = `No tasks match "<strong>${escHtml(state.searchQuery)}</strong>"`;
    document.getElementById('empty-cta').textContent = 'Clear Search';
    document.getElementById('empty-cta').onclick = () => {
      state.searchQuery = '';
      document.getElementById('search-input').value = '';
      renderTaskList();
    };
    return;
  }

  document.getElementById('empty-title').textContent = s.title;
  document.getElementById('empty-desc').innerHTML = s.desc;
  document.getElementById('empty-cta').textContent = s.cta;
  document.getElementById('empty-cta').onclick = () => {
    if (state.currentView === 'starred' || state.currentView === 'completed') navigateTo('all');
    else openAddModal();
  };
}

function renderTagsNav() {
  const allTags = [...new Set(state.tasks.flatMap(t => t.tags))].sort();
  const container = document.getElementById('tags-nav');
  if (!allTags.length) { container.innerHTML = ''; return; }

  container.innerHTML = allTags.map(tag => `
    <button class="nav-item${state.filterTag === tag ? ' active' : ''}" data-tag="${escHtml(tag)}">
      <span class="nav-tag-dot" style="background:${tagColor(tag)}" aria-hidden="true"></span>
      <span>#${escHtml(tag)}</span>
    </button>
  `).join('');

  container.querySelectorAll('[data-tag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (state.filterTag === tag) { state.filterTag = null; btn.classList.remove('active'); }
      else { state.filterTag = tag; }
      navigateTo('all');
    });
  });
}

function updateBadges() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayStart.getDate() + 1);
  const weekEnd = new Date(todayStart); weekEnd.setDate(todayStart.getDate() + 7);

  const active = state.tasks.filter(t => !t.completedAt);
  const todays = active.filter(t => t.dueAt && new Date(t.dueAt) >= todayStart && new Date(t.dueAt) < todayEnd);
  const upcoming = active.filter(t => t.dueAt && new Date(t.dueAt) >= todayEnd && new Date(t.dueAt) < weekEnd);
  const starred = active.filter(t => t.starred);

  setBadge('badge-today', todays.length);
  setBadge('badge-upcoming', upcoming.length);
  setBadge('badge-all', active.length);
  setBadge('badge-starred', starred.length);
}

function setBadge(id, count) {
  const el = document.getElementById(id);
  if (el) { el.textContent = count || ''; el.classList.toggle('hidden', !count); }
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const count = state.selectedIds.size;
  bar.classList.toggle('hidden', count === 0);
  document.getElementById('bulk-count').textContent = `${count} selected`;
}

function updateStorageInfo() {
  const bytes = Storage.getUsage();
  const kb = (bytes / 1024).toFixed(1);
  const pct = Math.min(100, (bytes / (5 * 1024 * 1024)) * 100); // 5MB quota estimate
  const el = document.getElementById('storage-used');
  const fill = document.getElementById('storage-fill');
  if (el) el.textContent = `${kb} KB used`;
  if (fill) fill.style.width = `${pct}%`;
}

/* ═══════════════════════════════════════════
   TASK CRUD
═══════════════════════════════════════════ */
function addTask(data) {
  const task = createTask({
    ...data,
    order: state.tasks.length ? Math.max(...state.tasks.map(t => t.order)) + 1 : 0
  });
  state.tasks.unshift(task);
  Storage.saveTasks(state.tasks);
  renderAll();
  showToast('Task added ✓', 'success');
  return task;
}

function updateTask(id, data) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  state.tasks[idx] = { ...state.tasks[idx], ...data, updatedAt: new Date().toISOString() };
  Storage.saveTasks(state.tasks);
  renderAll();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  state.selectedIds.delete(id);
  Storage.saveTasks(state.tasks);
  renderAll();
  showToast('Task deleted', 'danger');
}

function toggleComplete(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (task.completedAt) {
    task.completedAt = null;
  } else {
    task.completedAt = new Date().toISOString();
    // Animate confetti-like on complete
    scheduleCompletionCelebration();
  }
  task.updatedAt = new Date().toISOString();
  Storage.saveTasks(state.tasks);
  setTimeout(renderAll, 300); // Let CSS transition play
  updateBadges();
}

function toggleSelect(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  renderTaskList();
}

function reorderTasks(srcId, destId) {
  const src = state.tasks.find(t => t.id === srcId);
  const dest = state.tasks.find(t => t.id === destId);
  if (!src || !dest) return;
  // Swap orders
  const tmp = src.order;
  src.order = dest.order;
  dest.order = tmp;
  src.updatedAt = dest.updatedAt = new Date().toISOString();
  Storage.saveTasks(state.tasks);
  renderTaskList();
}

/* ═══════════════════════════════════════════
   MODAL
═══════════════════════════════════════════ */
function openAddModal() {
  state.editingTaskId = null;
  state.modalPriority = 'medium';
  state.modalStarred = false;
  state.modalSubtasks = [];

  document.getElementById('modal-title').textContent = 'New Task';
  document.getElementById('task-title-input').value = '';
  document.getElementById('task-desc-input').value = '';
  document.getElementById('task-due').value = '';
  document.getElementById('task-tags').value = '';
  document.getElementById('nlp-hints').innerHTML = '';

  const starBtn = document.getElementById('task-star');
  starBtn.classList.remove('active');
  starBtn.setAttribute('aria-pressed', 'false');

  setPriority('medium');
  renderModalSubtasks();
  showModal();
  setTimeout(() => document.getElementById('task-title-input').focus(), 50);
}

function openEditModal(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  state.editingTaskId = id;
  state.modalPriority = task.priority;
  state.modalStarred = task.starred;
  state.modalSubtasks = task.subtasks.map(s => ({ ...s }));

  document.getElementById('modal-title').textContent = 'Edit Task';
  document.getElementById('task-title-input').value = task.title;
  document.getElementById('task-desc-input').value = task.description || '';
  document.getElementById('task-due').value = task.dueAt ? datetimeLocal(new Date(task.dueAt)) : '';
  document.getElementById('task-tags').value = task.tags.map(t => `#${t}`).join(' ');

  const starBtn = document.getElementById('task-star');
  starBtn.classList.toggle('active', task.starred);
  starBtn.setAttribute('aria-pressed', String(task.starred));

  setPriority(task.priority);
  renderModalSubtasks();
  showModal();
  setTimeout(() => document.getElementById('task-title-input').focus(), 50);
}

function showModal() {
  document.getElementById('task-modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('task-modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  state.editingTaskId = null;
}

function saveModal() {
  const titleEl = document.getElementById('task-title-input');
  const title = titleEl.value.trim();
  if (!title) {
    titleEl.style.borderBottom = '2px solid var(--danger)';
    setTimeout(() => titleEl.style.borderBottom = '', 1500);
    titleEl.focus();
    return;
  }

  const dueVal = document.getElementById('task-due').value;
  const rawTags = document.getElementById('task-tags').value;
  const tags = rawTags.match(/#(\w+)/g)?.map(t => t.slice(1)) || [];

  const data = {
    title,
    description: document.getElementById('task-desc-input').value.trim(),
    dueAt: dueVal ? new Date(dueVal).toISOString() : null,
    priority: state.modalPriority,
    tags,
    starred: state.modalStarred,
    subtasks: state.modalSubtasks.filter(s => s.title.trim()),
  };

  if (state.editingTaskId) {
    updateTask(state.editingTaskId, data);
    showToast('Task updated ✓', 'success');
  } else {
    addTask(data);
  }
  closeModal();
}

function setPriority(p) {
  state.modalPriority = p;
  document.querySelectorAll('.priority-opt').forEach(b => b.classList.toggle('active', b.dataset.p === p));
}

function renderModalSubtasks() {
  const list = document.getElementById('subtask-list');
  list.innerHTML = state.modalSubtasks.map((s, i) => `
    <div class="subtask-item" data-index="${i}">
      <input type="checkbox" ${s.done ? 'checked' : ''} aria-label="Subtask ${i + 1}" />
      <input class="subtask-title-input" type="text" value="${escHtml(s.title)}" placeholder="Subtask title…" aria-label="Subtask title" />
      <button class="remove-subtask" data-index="${i}" aria-label="Remove subtask">×</button>
    </div>
  `).join('');

  list.querySelectorAll('.subtask-item').forEach((el, i) => {
    el.querySelector('input[type="checkbox"]').addEventListener('change', e => {
      state.modalSubtasks[i].done = e.target.checked;
    });
    el.querySelector('.subtask-title-input').addEventListener('input', e => {
      state.modalSubtasks[i].title = e.target.value;
    });
    el.querySelector('.remove-subtask').addEventListener('click', () => {
      state.modalSubtasks.splice(i, 1);
      renderModalSubtasks();
    });
  });
}

/* ═══════════════════════════════════════════
   CONTEXT MENU
═══════════════════════════════════════════ */
function showContextMenu(e, taskId) {
  removeContextMenu();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <button class="context-item" data-action="edit">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Edit Task
    </button>
    <button class="context-item" data-action="star">
      ${task.starred ? '★ Unstar' : '☆ Star'}
    </button>
    <button class="context-item" data-action="complete">
      ${task.completedAt ? '↩ Mark Incomplete' : '✓ Mark Complete'}
    </button>
    <div class="context-divider"></div>
    <button class="context-item danger" data-action="delete">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      Delete
    </button>
  `;

  document.body.appendChild(menu);

  // Position
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX, y = e.clientY;
  const mw = 180, mh = 160;
  if (x + mw > vw) x = vw - mw - 8;
  if (y + mh > vh) y = vh - mh - 8;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  menu.querySelectorAll('.context-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'edit') openEditModal(taskId);
      else if (action === 'star') updateTask(taskId, { starred: !task.starred });
      else if (action === 'complete') toggleComplete(taskId);
      else if (action === 'delete') confirmDelete(taskId);
      removeContextMenu();
    });
  });

  setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 10);
}

function removeContextMenu() {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());
}

/* ═══════════════════════════════════════════
   CONFIRM MODAL
═══════════════════════════════════════════ */
function confirm(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const ok = document.getElementById('confirm-ok');
  const cancel = document.getElementById('confirm-cancel');

  const cleanup = () => {
    document.getElementById('confirm-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    ok.replaceWith(ok.cloneNode(true));
    cancel.replaceWith(cancel.cloneNode(true));
  };

  document.getElementById('confirm-ok').addEventListener('click', () => { onConfirm(); cleanup(); }, { once: true });
  document.getElementById('confirm-cancel').addEventListener('click', cleanup, { once: true });
}

function confirmDelete(id) {
  const task = state.tasks.find(t => t.id === id);
  confirm(`Delete "${task?.title || 'task'}"? This cannot be undone.`, () => deleteTask(id));
}

/* ═══════════════════════════════════════════
   NLP QUICK ENTRY
═══════════════════════════════════════════ */
function updateNLPHints(text) {
  const hints = document.getElementById('nlp-hints');
  if (!text.trim()) { hints.innerHTML = ''; return; }

  const parsed = parseNLP(text);
  const chips = [];
  if (parsed.dueAt) chips.push(`📅 ${formatDate(parsed.dueAt)}`);
  if (parsed.priority !== 'medium') chips.push(`${parsed.priority === 'high' ? '🔴' : '🟢'} ${parsed.priority}`);
  parsed.tags.forEach(t => chips.push(`#${t}`));

  hints.innerHTML = chips.length ? chips.map(c => `<span class="nlp-chip">${escHtml(c)}</span>`).join('') : '';
}

/* ═══════════════════════════════════════════
   EXPORT / IMPORT
═══════════════════════════════════════════ */
function exportJSON() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: state.tasks,
    settings: state.settings,
  };
  download(`taskflow-backup-${dateStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
  showToast('Exported as JSON ✓', 'success');
}

function exportCSV() {
  const headers = ['id', 'title', 'description', 'priority', 'dueAt', 'completedAt', 'tags', 'starred', 'createdAt'];
  const rows = state.tasks.map(t =>
    headers.map(h => {
      const v = h === 'tags' ? t.tags.join(';') : (t[h] || '');
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  download(`taskflow-backup-${dateStr()}.csv`, csv, 'text/csv');
  showToast('Exported as CSV ✓', 'success');
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const content = e.target.result;
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(content);
        const tasks = Array.isArray(data) ? data : (data.tasks || []);
        confirm(`Import ${tasks.length} tasks? Existing tasks will be merged.`, () => {
          const existingIds = new Set(state.tasks.map(t => t.id));
          const newTasks = tasks.filter(t => !existingIds.has(t.id)).map(t => createTask(t));
          state.tasks = [...state.tasks, ...newTasks];
          Storage.saveTasks(state.tasks);
          renderAll();
          showToast(`Imported ${newTasks.length} tasks ✓`, 'success');
        });
      } else {
        showToast('Only JSON import is supported currently', 'warning');
      }
    } catch {
      showToast('Invalid file format', 'danger');
    }
  };
  reader.readAsText(file);
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════
   ONLINE / OFFLINE STATUS
═══════════════════════════════════════════ */
function updateOnlineStatus() {
  const online = navigator.onLine;
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  if (dot) { dot.className = `status-dot ${online ? 'online' : 'offline'}`; }
  if (text) text.textContent = online ? 'Online' : 'Offline';
  document.getElementById('status-indicator').title = online ? 'Online' : 'Working offline — all data saved locally';
}

function setupNetworkListeners() {
  window.addEventListener('online', () => { updateOnlineStatus(); showToast('Back online', 'success'); });
  window.addEventListener('offline', () => { updateOnlineStatus(); showToast('Working offline', 'warning'); });
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  toast.setAttribute('role', 'status');
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 200ms ease forwards';
    setTimeout(() => toast.remove(), 210);
  }, 3000);
}

/* ═══════════════════════════════════════════
   CELEBRATIONS
═══════════════════════════════════════════ */
function scheduleCompletionCelebration() {
  // Subtle: check if all tasks in current view are done
  const remaining = getFilteredTasks().filter(t => !t.completedAt);
  if (remaining.length === 0) {
    setTimeout(() => showToast('🎉 All tasks done! Amazing work!', 'success'), 400);
  }
}

/* ═══════════════════════════════════════════
   SIDEBAR CONTROLS
═══════════════════════════════════════════ */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isCollapsed = sidebar.classList.contains('collapsed');
  sidebar.classList.toggle('collapsed');
  document.getElementById('sidebar-toggle').setAttribute('aria-label', isCollapsed ? 'Collapse sidebar' : 'Expand sidebar');
}

function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

/* ═══════════════════════════════════════════
   KEYBOARD SHORTCUTS
═══════════════════════════════════════════ */
function handleGlobalKeys(e) {
  const target = e.target;
  const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
  const modalOpen = !document.getElementById('task-modal-overlay').classList.contains('hidden');

  if (e.key === 'Escape') {
    closeModal();
    document.getElementById('confirm-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    state.selectedIds.clear();
    renderTaskList();
    removeContextMenu();
    return;
  }

  if (modalOpen) return;

  if (!inInput) {
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAddModal(); }
    if (e.key === '/') { e.preventDefault(); document.getElementById('search-input').focus(); }
    if (e.key === 't' || e.key === 'T') toggleTheme();
    if (e.key === '?') navigateTo('settings');
  }

  if (e.key === 'Escape' && document.getElementById('search-input') === document.activeElement) {
    document.getElementById('search-input').blur();
    state.searchQuery = '';
    renderTaskList();
  }
}

/* ═══════════════════════════════════════════
   THEME
═══════════════════════════════════════════ */
function toggleTheme() {
  const curr = state.settings.theme;
  const next = curr === 'dark' ? 'light' : 'dark';
  state.settings.theme = next;
  Storage.saveSettings(state.settings);
  applySettings(state.settings);
}

/* ═══════════════════════════════════════════
   SEARCH (with debounce)
═══════════════════════════════════════════ */
let searchTimer;
function handleSearch(q) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = q;
    if (state.currentView === 'settings') navigateTo('all');
    renderTaskList();
  }, 120);
}

/* ═══════════════════════════════════════════
   FILTERS
═══════════════════════════════════════════ */
function syncFilters() {
  const priorities = [...document.querySelectorAll('.filter-priority:checked')].map(c => c.value);
  const dueEl = document.querySelector('.filter-due:checked');
  state.filterPriorities = priorities;
  state.filterDue = dueEl ? dueEl.value : '';
  const total = priorities.length + (state.filterDue ? 1 : 0);
  const badge = document.getElementById('filter-badge');
  badge.textContent = total;
  badge.classList.toggle('hidden', !total);
  renderTaskList();
  renderActiveFilters();
}

function renderActiveFilters() {
  const bar = document.getElementById('active-filters');
  const chips = [];
  state.filterPriorities.forEach(p => chips.push(`Priority: ${p}`));
  if (state.filterDue) chips.push(`Due: ${state.filterDue}`);
  if (chips.length) {
    bar.innerHTML = `<span style="font-weight:600;color:var(--text-muted)">Filters:</span> ` +
      chips.map(c => `<span class="filter-tag">${escHtml(c)}</span>`).join('');
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}

function clearFilters() {
  document.querySelectorAll('.filter-priority').forEach(c => c.checked = false);
  document.querySelectorAll('.filter-due').forEach(r => r.checked = false);
  state.filterPriorities = [];
  state.filterDue = '';
  document.getElementById('filter-badge').classList.add('hidden');
  document.getElementById('active-filters').classList.add('hidden');
  renderTaskList();
}

/* ═══════════════════════════════════════════
   NOTIFICATIONS
═══════════════════════════════════════════ */
async function requestNotifications(enable) {
  if (!enable) {
    state.settings.notifications = false;
    Storage.saveSettings(state.settings);
    document.getElementById('notif-status-text').textContent = 'Disabled';
    return;
  }
  if (!('Notification' in window)) {
    showToast('Notifications not supported', 'warning');
    document.getElementById('notif-toggle').checked = false;
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    state.settings.notifications = true;
    Storage.saveSettings(state.settings);
    document.getElementById('notif-status-text').textContent = 'Enabled';
    showToast('Notifications enabled ✓', 'success');
  } else {
    document.getElementById('notif-toggle').checked = false;
    document.getElementById('notif-status-text').textContent = 'Permission denied';
    showToast('Notification permission denied', 'danger');
  }
}

/* ═══════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════ */
function setupEventListeners() {
  // Sidebar toggle
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('mobile-menu-btn')?.addEventListener('click', openMobileSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeMobileSidebar);

  // Nav items
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.view));
  });

  // FABs + Quick Add
  document.getElementById('fab-desktop').addEventListener('click', openAddModal);
  document.getElementById('fab-mobile').addEventListener('click', openAddModal);
  document.getElementById('sidebar-quick-add').addEventListener('click', openAddModal);
  document.getElementById('empty-cta').addEventListener('click', openAddModal);

  // Search
  document.getElementById('search-input').addEventListener('input', e => handleSearch(e.target.value));
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.target.value = ''; handleSearch(''); e.target.blur(); }
  });

  // Sort
  document.getElementById('sort-select').addEventListener('change', e => {
    state.sortBy = e.target.value;
    renderTaskList();
  });

  // Filter
  document.getElementById('filter-btn').addEventListener('click', e => {
    e.stopPropagation();
    const dd = document.getElementById('filter-dropdown');
    const open = !dd.classList.contains('hidden');
    dd.classList.toggle('hidden');
    document.getElementById('filter-btn').setAttribute('aria-expanded', String(!open));
  });
  document.querySelectorAll('.filter-priority, .filter-due').forEach(el => {
    el.addEventListener('change', syncFilters);
  });
  document.getElementById('clear-filters').addEventListener('click', clearFilters);
  document.addEventListener('click', e => {
    if (!e.target.closest('.filter-wrap')) {
      document.getElementById('filter-dropdown').classList.add('hidden');
    }
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveModal);
  document.getElementById('task-modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('task-modal-overlay')) closeModal();
  });

  // Priority opts
  document.querySelectorAll('.priority-opt').forEach(btn => {
    btn.addEventListener('click', () => setPriority(btn.dataset.p));
  });

  // Star
  document.getElementById('task-star').addEventListener('click', () => {
    state.modalStarred = !state.modalStarred;
    document.getElementById('task-star').classList.toggle('active', state.modalStarred);
    document.getElementById('task-star').setAttribute('aria-pressed', String(state.modalStarred));
  });

  // NLP hints
  document.getElementById('task-title-input').addEventListener('input', e => {
    updateNLPHints(e.target.value);

    // Auto-parse when user presses Enter
    const parsed = parseNLP(e.target.value);
    if (parsed.dueAt && document.getElementById('task-due').value === '') {
      document.getElementById('task-due').value = datetimeLocal(new Date(parsed.dueAt));
    }
    if (parsed.tags.length && document.getElementById('task-tags').value === '') {
      document.getElementById('task-tags').value = parsed.tags.map(t => `#${t}`).join(' ');
    }
    if (parsed.priority !== 'medium') setPriority(parsed.priority);
  });

  document.getElementById('task-title-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveModal();
    }
  });

  // Subtasks
  document.getElementById('add-subtask-btn').addEventListener('click', () => {
    state.modalSubtasks.push({ id: `s_${Date.now()}`, title: '', done: false });
    renderModalSubtasks();
    const inputs = document.querySelectorAll('.subtask-title-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  // Bulk actions
  document.getElementById('bulk-complete').addEventListener('click', () => {
    state.selectedIds.forEach(id => {
      const t = state.tasks.find(x => x.id === id);
      if (t && !t.completedAt) { t.completedAt = new Date().toISOString(); t.updatedAt = t.completedAt; }
    });
    Storage.saveTasks(state.tasks);
    state.selectedIds.clear();
    renderAll();
    showToast('Tasks completed ✓', 'success');
  });
  document.getElementById('bulk-delete').addEventListener('click', () => {
    const count = state.selectedIds.size;
    confirm(`Delete ${count} task${count > 1 ? 's' : ''}? This cannot be undone.`, () => {
      state.tasks = state.tasks.filter(t => !state.selectedIds.has(t.id));
      state.selectedIds.clear();
      Storage.saveTasks(state.tasks);
      renderAll();
      showToast(`${count} tasks deleted`, 'danger');
    });
  });
  document.getElementById('bulk-deselect').addEventListener('click', () => {
    state.selectedIds.clear();
    renderTaskList();
  });

  // Settings — Theme
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.t;
      Storage.saveSettings(state.settings);
      applySettings(state.settings);
    });
  });

  // Settings — Accent
  document.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.accent = btn.dataset.accent;
      Storage.saveSettings(state.settings);
      applySettings(state.settings);
    });
  });

  // Settings — Density
  document.querySelectorAll('.density-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.density = btn.dataset.density;
      Storage.saveSettings(state.settings);
      applySettings(state.settings);
      document.querySelectorAll('.density-opt').forEach(b => b.classList.toggle('active', b.dataset.density === state.settings.density));
    });
  });

  // Settings — Default Sort / View
  document.getElementById('default-sort-setting').addEventListener('change', e => {
    state.settings.defaultSort = e.target.value;
    Storage.saveSettings(state.settings);
  });
  document.getElementById('default-view-setting').addEventListener('change', e => {
    state.settings.defaultView = e.target.value;
    Storage.saveSettings(state.settings);
  });

  // Settings — Notifications
  document.getElementById('notif-toggle').addEventListener('change', e => {
    requestNotifications(e.target.checked);
  });
  document.getElementById('reminder-time').addEventListener('change', e => {
    state.settings.reminderMinutes = parseInt(e.target.value);
    Storage.saveSettings(state.settings);
  });

  // Settings — Export/Import
  document.getElementById('export-json').addEventListener('click', exportJSON);
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files[0]) importFile(e.target.files[0]);
    e.target.value = '';
  });

  // Settings — Clear
  document.getElementById('clear-data-btn').addEventListener('click', () => {
    confirm('Clear ALL tasks and settings? This cannot be undone.', () => {
      localStorage.clear();
      state.tasks = [];
      state.settings = Storage.getSettings();
      applySettings(state.settings);
      renderAll();
      showToast('All data cleared', 'danger');
    });
  });

  // Confirm modal close on overlay click
  document.getElementById('confirm-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('confirm-overlay')) {
      document.getElementById('confirm-overlay').classList.add('hidden');
      document.body.style.overflow = '';
    }
  });
}

/* ═══════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════ */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(todayStart); tomorrow.setDate(todayStart.getDate() + 1);
  const dayAfter = new Date(tomorrow); dayAfter.setDate(tomorrow.getDate() + 1);

  if (d >= todayStart && d < tomorrow) return `Today ${d.getHours() > 0 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`.trim();
  if (d >= tomorrow && d < dayAfter) return `Tomorrow`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (d.getHours() ? ` ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '');
}

function datetimeLocal(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function tagColor(tag) {
  let h = 0;
  for (let c of tag) h = (h * 31 + c.charCodeAt(0)) & 0xffffff;
  return `hsl(${h % 360},60%,55%)`;
}

/* ═══════════════════════════════════════════
   SERVICE WORKER REGISTRATION
═══════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // SW not found — app still works, just won't cache offline
    });
  });
}

/* ═══════════════════════════════════════════
   BOOTSTRAP DEMO DATA (first run)
═══════════════════════════════════════════ */
function seedDemoTasks() {
  if (localStorage.getItem('tf_seeded')) return;
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const next3 = new Date(today); next3.setDate(today.getDate() + 3);

  const demo = [
    { title: 'Welcome to TaskFlow! ✨', description: 'Your offline-first task manager. Click to edit or press N for a new task.', priority: 'low', dueAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59).toISOString(), tags: ['intro'], starred: true },
    { title: 'Try adding a task with natural language', description: 'Type: "Meeting tomorrow 9am #work !high" in the add dialog', priority: 'medium', dueAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 18, 0).toISOString(), tags: ['tip'] },
    { title: 'Review project roadmap', description: 'Check milestones for Q2', priority: 'high', dueAt: tomorrow.toISOString(), tags: ['work'], subtasks: [{ id: 's1', title: 'Review design mockups', done: true }, { id: 's2', title: 'Update timelines', done: false }] },
    { title: 'Buy groceries', priority: 'low', tags: ['personal'], dueAt: tomorrow.toISOString() },
    { title: 'Read 30 minutes before bed', priority: 'low', tags: ['health', 'personal'], dueAt: next3.toISOString() },
  ];

  demo.forEach((d, i) => {
    state.tasks.push(createTask({ ...d, order: i }));
  });
  Storage.saveTasks(state.tasks);
  localStorage.setItem('tf_seeded', '1');
}

/* ═══════════════════════════════════════════
   START
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  seedDemoTasks();
  init();
});
