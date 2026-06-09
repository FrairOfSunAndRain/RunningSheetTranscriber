/**
 * Transcribe Page
 * Primary working environment for recording incidents from audio.
 */
const TranscribePage = (() => {
  let entries = [];
  let tags = [];
  let audioFiles = [];
  let tagInputInstances = {};
  let autosaveTimer = null;
  let timeAdjustHotkeys = { add: 'PageUp', subtract: 'PageDown' };

  function setTimeAdjustHotkeys(h) {
    if (h) timeAdjustHotkeys = { ...timeAdjustHotkeys, ...h };
    AudioPlayer.setExtraHints([
      { key: timeAdjustHotkeys.add, label: 'Time +' },
      { key: timeAdjustHotkeys.subtract, label: 'Time −' },
    ]);
    AudioPlayer.showPlayerBar();
  }

  /**
   * Adjust only the leading digits of a time string by delta.
   * e.g. "25.30" + 1 → "26.30", "37+2" − 1 → "36+2", "45" + 5 → "50"
   */
  function adjustLeadingDigits(timeValue, delta) {
    const match = timeValue.match(/^(\d+)(.*)/);
    if (!match) return timeValue;
    const newLeading = Math.max(0, parseInt(match[1], 10) + delta);
    return String(newLeading) + match[2];
  }

  /**
   * Render the transcribe page
   */
  async function render(container) {
    const sheet = App.getActiveSheet();
    const sheetId = App.getActiveSheetId();

    if (!sheet) {
      container.innerHTML = `
        <div class="transcribe-page">
          <div class="empty-state" style="height:100%">
            <p class="empty-state-title">No Running Sheet Open</p>
            <p class="empty-state-text">Open a running sheet from the Manager to start transcribing.</p>
          </div>
        </div>
      `;
      return;
    }

    entries = sheet.entries || [];
    tags = sheet.tags || [];
    audioFiles = sheet.audioFiles || [];

    // Initialize audio player if not already
    if (!AudioPlayer.getFiles().length || AudioPlayer.getFiles() !== audioFiles) {
      AudioPlayer.loadFiles(audioFiles);
    }

    // Auto-create entries for audio files that don't have one yet
    await autoCreateEntries(sheetId);

    // Set up file change callback
    AudioPlayer.onFileChange((index, filePath) => {
      highlightCurrentFileRows();
      scrollToFileEntries(filePath);
    });

    renderPage(container);
  }

  /**
   * Auto-create one entry per audio file that doesn't already have an entry
   */
  async function autoCreateEntries(sheetId) {
    let added = false;
    audioFiles.forEach((filePath) => {
      const fileName = AudioPlayer.getFileName(filePath);
      const hasEntry = entries.some(e =>
        e.linkedFiles && e.linkedFiles.some(f =>
          AudioPlayer.getFileName(f) === fileName
        )
      );
      if (!hasEntry) {
        entries.push({
          id: Storage.generateId(),
          time: '',
          comment: '',
          tags: [],
          included: true,
          linkedFiles: [filePath],
          order: entries.length,
        });
        added = true;
      }
    });

    if (added) {
      await Storage.saveEntries(sheetId, entries);
    }
  }

  /**
   * Render the full page
   */
  function renderPage(container) {
    // Preserve scroll position across re-renders
    const existingWrapper = document.getElementById('transcribe-table-wrapper');
    const savedScroll = existingWrapper ? existingWrapper.scrollTop : null;

    container.innerHTML = `
      <div class="transcribe-page">
        <div class="transcribe-header">
          <h2>Transcribe</h2>
          <div class="transcribe-actions">
            <button class="btn btn-secondary btn-sm" id="btn-import-audio">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18V5l12-2v13"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
              </svg>
              Import Audio
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-add-entry">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round"/>
                <line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round"/>
              </svg>
              Add Entry
            </button>
            <div class="time-adjust-control" title="Enter an increment and click Set, then use ${timeAdjustHotkeys.add} / ${timeAdjustHotkeys.subtract} on a focused time field to adjust">
              <span class="time-adjust-label">Time Adj.</span>
              <input type="number" id="time-adjust-increment" class="time-adjust-input is-set" value="45" min="1" max="999">
              <button class="btn btn-ghost btn-sm btn-time-adjust-set" id="btn-time-adjust-set">Set</button>
            </div>
          </div>
        </div>

        <div class="transcribe-table-wrapper" id="transcribe-table-wrapper">
          ${renderEntryTable()}
        </div>
      </div>
    `;

    // Show player bar at bottom
    AudioPlayer.setExtraHints([
      { key: timeAdjustHotkeys.add, label: 'Time +' },
      { key: timeAdjustHotkeys.subtract, label: 'Time −' },
    ]);
    AudioPlayer.showPlayerBar();

    // Bind events
    bindTranscribeEvents();
    initHighlightDropdowns();
    initTextHighlightToolbar();
    highlightCurrentFileRows();
    setupAutoExpand();
    initSpellCheckContextMenu();

    // Restore scroll position (or top on first render)
    const tw = document.getElementById('transcribe-table-wrapper');
    if (tw) tw.scrollTop = savedScroll !== null ? savedScroll : 0;
  }

  /**
   * Render the entry table
   */
  function renderEntryTable() {
    if (entries.length === 0) {
      return `
        <div class="transcribe-empty">
          <p>No entries yet. Import audio files and they will appear here.</p>
        </div>
      `;
    }

    let rows = '';
    // Count total visible columns (drag + file + time + comment + highlight + tools)
    const totalCols = 6;

    entries.forEach((entry, index) => {
      // Period Break row — special rendering
      if (entry.type === 'break') {
        rows += `
          <tr data-entry-id="${entry.id}" data-index="${index}" class="period-break-row">
            <td class="col-drag">
              <div class="drag-handle" title="Drag to reorder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                  <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                  <circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/>
                  <circle cx="9" cy="15" r="1.5"/><circle cx="15" cy="15" r="1.5"/>
                  <circle cx="9" cy="20" r="1.5"/><circle cx="15" cy="20" r="1.5"/>
                </svg>
              </div>
            </td>
            <td colspan="${totalCols - 1}" class="period-break-cell">
              <div class="period-break-label">⏸ ${entry.breakLabel || 'BREAK'}</div>
              <button class="btn btn-ghost btn-sm btn-entry-delete period-break-delete" data-entry-id="${entry.id}" title="Remove Break">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6L18 18" stroke-linecap="round"/>
                </svg>
              </button>
            </td>
          </tr>
        `;
        return; // skip normal rendering
      }

      // Build file list — each linked file gets its own play button and badge
      let fileListHtml = '';
      const linkBtnHtml = `<button class="btn btn-ghost btn-sm btn-entry-link" data-entry-id="${entry.id}" title="Link Files" style="padding:1px 3px; opacity:0.45; flex-shrink:0;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
        </svg>
      </button>`;

      if (entry.linkedFiles && entry.linkedFiles.length > 0) {
        entry.linkedFiles.forEach((filePath, fileIndex) => {
          const fileName = AudioPlayer.getFileName(filePath);
          const isThisPlaying = AudioPlayer.getCurrentFile() === filePath;
          fileListHtml += `
            <div class="linked-file-row">
              <button class="btn btn-ghost btn-sm btn-play-file" data-file-path="${filePath}" title="Play ${fileName}" style="padding:2px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  ${isThisPlaying && AudioPlayer.getIsPlaying()
                    ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
                    : '<path d="M8 5v14l11-7z"/>'
                  }
                </svg>
              </button>
              ${fileIndex === 0 ? linkBtnHtml : ''}
              <span class="entry-file-badge ${isThisPlaying ? 'is-playing' : ''}"
                    data-file-path="${filePath}"
                    title="${filePath}">
                ${fileName}
              </span>
            </div>
          `;
        });
      } else {
        fileListHtml = `<div class="linked-file-row">${linkBtnHtml}<span class="entry-file-badge" style="opacity:0.5">—</span></div>`;
      }

      rows += `
        <tr data-entry-id="${entry.id}" data-index="${index}">
          <td class="col-drag">
            <div class="drag-handle" title="Drag to reorder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                <circle cx="9" cy="10" r="1.5"/><circle cx="15" cy="10" r="1.5"/>
                <circle cx="9" cy="15" r="1.5"/><circle cx="15" cy="15" r="1.5"/>
                <circle cx="9" cy="20" r="1.5"/><circle cx="15" cy="20" r="1.5"/>
              </svg>
            </div>
          </td>
          <td class="col-file">
            <div class="linked-files-list">
              ${fileListHtml}
            </div>
          </td>
          <td class="col-time">
            <input type="text" class="entry-time-input"
                   data-entry-id="${entry.id}"
                   data-field="time"
                   value="${entry.time || ''}"
                   placeholder="MM"
                   tabindex="0">
          </td>
          <td class="col-comment">
            <div class="entry-comment-input" contenteditable="true" spellcheck="true"
                 data-entry-id="${entry.id}"
                 data-field="comment"
                 tabindex="0">${entry.comment || ''}</div>
          </td>
          <td class="col-highlight">
            <select class="entry-highlight-select"
                    data-entry-id="${entry.id}"
                    tabindex="0">
              <option value="">None</option>
              <option value="incident" style="color:#00B050; font-weight:600;" ${entry.highlight === 'incident' ? 'selected' : ''}>🟢 Incident of Interest</option>
              <option value="key" style="color:#2E75B6; font-weight:600;" ${entry.highlight === 'key' ? 'selected' : ''}>🔵 Key Match Incident</option>
            </select>
          </td>
          <td class="col-tools">
            <div class="entry-tools">
              <button class="btn btn-ghost btn-sm btn-entry-insert" data-index="${index}" title="Insert Entry Above">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button class="btn btn-ghost btn-sm btn-entry-delete" data-entry-id="${entry.id}" title="Delete Entry">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6L18 18" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    return `
      <table class="entry-table">
        <thead>
          <tr>
            <th class="col-drag"></th>
            <th class="col-file">File</th>
            <th class="col-time">Time</th>
            <th class="col-comment">Incident / Comment</th>
            <th class="col-highlight">Highlight</th>
            <th class="col-tools">Tools</th>
          </tr>
        </thead>
        <tbody id="entry-table-body">
          ${rows}
        </tbody>
      </table>
    `;
  }

  /**
   * Bind highlight dropdown change events and style rows
   */
  function initHighlightDropdowns() {
    document.querySelectorAll('.entry-highlight-select').forEach(select => {
      // Apply initial row color
      applyHighlightColor(select);

      select.addEventListener('change', () => {
        const entry = entries.find(e => e.id === select.dataset.entryId);
        if (entry) {
          entry.highlight = select.value || '';
          applyHighlightColor(select);
          scheduleAutosave();
        }
      });
    });
  }

  function applyHighlightColor(select) {
    const row = select.closest('tr');
    if (!row) return;
    if (select.value === 'incident') {
      row.style.backgroundColor = 'rgba(0, 176, 80, 0.3)';
      select.style.color = '#00B050';
      select.style.fontWeight = '600';
    } else if (select.value === 'key') {
      row.style.backgroundColor = 'rgba(46, 117, 182, 0.3)';
      select.style.color = '#2E75B6';
      select.style.fontWeight = '600';
    } else {
      row.style.backgroundColor = '';
      select.style.color = '';
      select.style.fontWeight = '';
    }
  }

  /**
   * Text highlight toolbar — yellow/red for card highlights
   */
  function initTextHighlightToolbar() {
    // Create the floating toolbar if not already present
    let toolbar = document.getElementById('text-highlight-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'text-highlight-toolbar';
      toolbar.className = 'text-highlight-toolbar';
      toolbar.innerHTML = `
        <button class="tht-btn tht-yellow" data-color="#FFFF00" title="Highlight Yellow">
          <span class="tht-swatch" style="background:#FFFF00;"></span> Yellow
        </button>
        <button class="tht-btn tht-red" data-color="#FF0000" title="Highlight Red">
          <span class="tht-swatch" style="background:#FF0000;"></span> Red
        </button>
        <button class="tht-btn tht-clear" data-color="" title="Clear Highlight">
          ✕ Clear
        </button>
      `;
      document.body.appendChild(toolbar);

      // Handle highlight button clicks
      toolbar.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Don't lose selection
        const btn = e.target.closest('.tht-btn');
        if (!btn) return;

        const color = btn.dataset.color;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) return;

        const range = sel.getRangeAt(0);
        const commentDiv = range.startContainer.closest
          ? range.startContainer.closest('.entry-comment-input')
          : range.startContainer.parentElement?.closest('.entry-comment-input');
        if (!commentDiv) return;

        // Snapshot before highlight change for undo
        const highlightDesc = color ? (color === '#FF0000' ? 'red highlight' : 'yellow highlight') : 'clear highlight';
        UndoRedo.snapshot(entries, highlightDesc);

        if (color) {
          // Wrap selection in a mark element
          const mark = document.createElement('mark');
          mark.style.backgroundColor = color;
          mark.style.color = color === '#FF0000' ? '#FFFFFF' : '#000000';
          mark.style.padding = '0 2px';
          mark.style.borderRadius = '2px';
          mark.className = 'text-mark';
          try {
            range.surroundContents(mark);
          } catch (err) {
            // If selection spans multiple nodes, extract and wrap
            const fragment = range.extractContents();
            mark.appendChild(fragment);
            range.insertNode(mark);
          }
        } else {
          // Clear: remove mark elements that overlap with the selection
          const container = range.commonAncestorContainer;
          const el = container.nodeType === 1 ? container : container.parentElement;

          // Collect all marks to remove
          const marksToRemove = new Set();

          // Case 1: The container itself is a mark (selected text within a single mark)
          if (el && el.matches && el.matches('mark.text-mark')) {
            marksToRemove.add(el);
          }

          // Case 2: An ancestor is a mark (selected exactly the text inside a mark)
          const ancestorMark = el?.closest('mark.text-mark');
          if (ancestorMark) {
            marksToRemove.add(ancestorMark);
          }

          // Case 3: Marks inside the selection range
          const childMarks = el?.querySelectorAll('mark.text-mark');
          if (childMarks) {
            childMarks.forEach(m => marksToRemove.add(m));
          }

          // Unwrap all found marks
          marksToRemove.forEach(m => {
            const parent = m.parentNode;
            while (m.firstChild) parent.insertBefore(m.firstChild, m);
            m.remove();
          });
        }

        // Update entry data
        const entry = entries.find(e => e.id === commentDiv.dataset.entryId);
        if (entry) {
          entry.comment = commentDiv.innerText.trim() === '' ? '' : commentDiv.innerHTML;
          scheduleAutosave();
          UndoRedo.commit(entries, highlightDesc);
        }

        toolbar.classList.remove('visible');
      });
    }

    // Show/hide toolbar on selection change
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
        toolbar.classList.remove('visible');
        return;
      }

      // Check if selection is inside a comment div
      const anchor = sel.anchorNode;
      const commentDiv = anchor?.nodeType === 1
        ? anchor.closest('.entry-comment-input')
        : anchor?.parentElement?.closest('.entry-comment-input');
      if (!commentDiv) {
        toolbar.classList.remove('visible');
        return;
      }

      // Position toolbar above selection
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      toolbar.style.left = (rect.left + rect.width / 2 - 90) + 'px';
      toolbar.style.top = (rect.top - 40) + 'px';
      toolbar.classList.add('visible');
    });
  }

  /**
   * Bind transcribe page events
   */
  function bindTranscribeEvents() {
    // Add entry button
    document.getElementById('btn-add-entry')?.addEventListener('click', addManualEntry);

    // Import Audio button
    document.getElementById('btn-import-audio')?.addEventListener('click', async () => {
      const folder = await window.api.dialog.selectDirectory('Select Audio Files Folder');
      if (!folder) return;

      const scannedFiles = await window.api.audio.scanFolder(folder);
      if (scannedFiles.length === 0) {
        App.showToast('No supported audio files found in that folder', 'error');
        return;
      }

      const sheetId = App.getActiveSheetId();
      const existingPaths = new Set(audioFiles.map(f => f.toLowerCase()));
      let added = 0;
      scannedFiles.forEach((f) => {
        if (!existingPaths.has(f.path.toLowerCase())) {
          audioFiles.push(f.path);
          existingPaths.add(f.path.toLowerCase());
          added++;
        }
      });

      await Storage.saveAudioReferences(sheetId, audioFiles);
      await autoCreateEntries(sheetId);
      await Storage.saveEntries(sheetId, entries);
      AudioPlayer.loadFiles(audioFiles);
      await App.refreshActiveSheet();
      renderPage(document.getElementById('page-container'));
      App.showToast(`${added} audio file${added !== 1 ? 's' : ''} imported`, 'success');
    });

    // Time Adjust — turn yellow on input change, green on Set
    const timeAdjInput = document.getElementById('time-adjust-increment');
    const timeAdjSetBtn = document.getElementById('btn-time-adjust-set');
    timeAdjInput?.addEventListener('input', () => {
      timeAdjInput.classList.remove('is-set');
    });
    timeAdjSetBtn?.addEventListener('click', () => {
      timeAdjInput.classList.add('is-set');
    });

    // Field changes — time inputs (standard)
    document.querySelectorAll('.entry-time-input').forEach((input) => {
      input.addEventListener('focus', () => {
        UndoRedo.snapshot(entries, 'time edit');
      });
      input.addEventListener('input', () => {
        const entry = entries.find(e => e.id === input.dataset.entryId);
        if (entry) {
          entry.time = input.value;
          scheduleAutosave();
        }
      });
      input.addEventListener('blur', () => {
        UndoRedo.commit(entries);
      });

      // Time adjust hotkeys
      input.addEventListener('keydown', (e) => {
        if (e.key !== timeAdjustHotkeys.add && e.key !== timeAdjustHotkeys.subtract) return;
        e.preventDefault();

        const adjInput = document.getElementById('time-adjust-increment');
        if (!adjInput?.classList.contains('is-set')) return; // not confirmed via Set

        const entry = entries.find(en => en.id === input.dataset.entryId);
        if (!entry) return;

        if (!/^\d/.test(entry.time || '')) {
          Modal.show({
            title: 'Time Adjustment',
            body: '<p style="color:var(--text-secondary);">Unable to perform time adjustment — numerical figures need to be at the start of the field entry to have effect.</p>',
            buttons: [{ label: 'OK', class: 'btn-primary', onClick: () => Modal.hide() }],
          });
          return;
        }

        const increment = Math.max(1, parseInt(adjInput.value || '1', 10));
        const dir = e.key === timeAdjustHotkeys.add ? 1 : -1;
        UndoRedo.snapshot(entries, 'time adjust');
        entry.time = adjustLeadingDigits(entry.time, dir * increment);
        UndoRedo.commit(entries);
        input.value = entry.time;
        scheduleAutosave();
      });
    });

    // Field changes — comment contenteditable divs
    document.querySelectorAll('.entry-comment-input').forEach((div) => {
      div.addEventListener('focus', () => {
        UndoRedo.snapshot(entries, 'comment edit');
      });
      div.addEventListener('input', () => {
        const entry = entries.find(e => e.id === div.dataset.entryId);
        if (entry) {
          const isEmpty = div.innerText.trim() === '';
          if (isEmpty) div.innerHTML = '';
          entry.comment = isEmpty ? '' : div.innerHTML;
          scheduleAutosave();
        }
      });
      div.addEventListener('blur', () => {
        UndoRedo.commit(entries);
      });

      // Paste as plain text (keep only highlights)
      div.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      });
    });


    // Tab navigation: Time → Comment → Tags → next row Time
    document.querySelectorAll('.entry-time-input, .entry-comment-input').forEach((input) => {
      input.addEventListener('keydown', handleTabNavigation);
    });

    // Per-file play buttons
    document.querySelectorAll('.btn-play-file').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filePath = btn.dataset.filePath;
        if (!filePath) return;
        const fileIdx = audioFiles.indexOf(filePath);
        if (fileIdx >= 0) {
          if (AudioPlayer.getCurrentIndex() === fileIdx && AudioPlayer.getIsPlaying()) {
            await AudioPlayer.togglePlayPause();
          } else {
            await AudioPlayer.goToFile(fileIdx);
            await AudioPlayer.togglePlayPause();
          }
          setTimeout(() => renderPage(document.getElementById('page-container')), 100);
        }
      });
    });

    // File badge click — jump audio to that file
    document.querySelectorAll('.entry-file-badge[data-file-path]').forEach((badge) => {
      badge.addEventListener('click', () => {
        const filePath = badge.dataset.filePath;
        if (!filePath) return;
        const fileIdx = audioFiles.indexOf(filePath);
        if (fileIdx >= 0) {
          AudioPlayer.goToFile(fileIdx);
        }
      });
    });

    // Insert entry above
    document.querySelectorAll('.btn-entry-insert').forEach((btn) => {
      btn.addEventListener('click', () => insertEntryAt(parseInt(btn.dataset.index)));
    });

    // Link files
    document.querySelectorAll('.btn-entry-link').forEach((btn) => {
      btn.addEventListener('click', () => showLinkFilesModal(btn.dataset.entryId));
    });

    // Delete entry
    document.querySelectorAll('.btn-entry-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        Modal.confirm({
          title: 'Delete Entry',
          message: 'Are you sure you want to delete this entry?',
          confirmLabel: 'Delete',
          confirmClass: 'btn-danger',
          onConfirm: async () => {
            entries = entries.filter(e => e.id !== btn.dataset.entryId);
            await Storage.saveEntries(App.getActiveSheetId(), entries);
            await App.refreshActiveSheet();
            renderPage(document.getElementById('page-container'));
            App.showToast('Entry deleted', 'success');
          },
        });
      });
    });

    // Drag and drop
    initDragAndDrop();

    // Right-click context menu on rows
    document.querySelectorAll('.entry-table tbody tr').forEach(row => {
      row.addEventListener('contextmenu', (e) => {
        // If clicking inside a comment field, let Electron's native
        // context-menu handle it so spell suggestions are shown
        if (e.target.closest('.entry-comment-input')) return;
        e.preventDefault();
        const index = parseInt(row.dataset.index);
        const entryId = row.dataset.entryId;
        showRowContextMenu(e.clientX, e.clientY, index, entryId);
      });
    });
  }

  /**
   * Initialize HTML5 drag-and-drop on table rows
   */
  function initDragAndDrop() {
    let dragSrcIndex = null;

    // Only allow drag when initiated from the drag handle
    document.querySelectorAll('.entry-table tbody tr .drag-handle').forEach(handle => {
      handle.addEventListener('mousedown', () => {
        const row = handle.closest('tr');
        if (row) row.setAttribute('draggable', 'true');
      });
    });

    // Reset draggable on mouseup anywhere
    document.addEventListener('mouseup', () => {
      document.querySelectorAll('.entry-table tbody tr[draggable="true"]').forEach(r => {
        r.setAttribute('draggable', 'false');
      });
    });

    document.querySelectorAll('.entry-table tbody tr').forEach(row => {
      row.addEventListener('dragstart', (e) => {
        dragSrcIndex = parseInt(row.dataset.index);
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.index);
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        row.setAttribute('draggable', 'false');
        document.querySelectorAll('.entry-table tbody tr').forEach(r => {
          r.classList.remove('drag-over-top', 'drag-over-bottom');
        });
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Clear all indicators
        document.querySelectorAll('.entry-table tbody tr').forEach(r => {
          r.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          row.classList.add('drag-over-top');
        } else {
          row.classList.add('drag-over-bottom');
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetIndex = parseInt(row.dataset.index);
        if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        let insertAt = e.clientY < midY ? targetIndex : targetIndex + 1;

        // Remove from old position
        const [moved] = entries.splice(dragSrcIndex, 1);
        if (dragSrcIndex < insertAt) insertAt--;
        entries.splice(insertAt, 0, moved);

        entries.forEach((ent, i) => ent.order = i);
        Storage.saveEntries(App.getActiveSheetId(), entries);
        renderPage(document.getElementById('page-container'));
        App.showToast('Entry moved', 'info');
      });
    });
  }

  /**
   * Insert a blank entry at a specific position
   */
  async function insertEntryAt(index) {
    const currentFile = AudioPlayer.getCurrentFile();
    const newEntry = {
      id: Storage.generateId(),
      time: '',
      comment: '',
      highlight: '',
      included: true,
      linkedFiles: currentFile ? [currentFile] : [],
      order: index,
    };

    entries.splice(index, 0, newEntry);
    entries.forEach((e, i) => e.order = i);

    await Storage.saveEntries(App.getActiveSheetId(), entries);
    await App.refreshActiveSheet();
    renderPage(document.getElementById('page-container'));

    setTimeout(() => {
      const timeInput = document.querySelector(`.entry-time-input[data-entry-id="${newEntry.id}"]`);
      if (timeInput) {
        timeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        timeInput.focus();
      }
    }, 50);
  }

  /**
   * Insert a period break at a specific position
   */
  async function insertBreakAt(index, label) {
    const breakEntry = {
      id: Storage.generateId(),
      type: 'break',
      breakLabel: label,
      included: true,
      order: index,
    };

    entries.splice(index, 0, breakEntry);
    entries.forEach((e, i) => e.order = i);

    await Storage.saveEntries(App.getActiveSheetId(), entries);
    await App.refreshActiveSheet();
    renderPage(document.getElementById('page-container'));
    App.showToast(`${label} break inserted`, 'success');
  }

  /**
   * Show right-click context menu on a row
   */
  function showRowContextMenu(x, y, index, entryId) {
    // Remove any existing context menu
    document.getElementById('row-context-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'row-context-menu';
    menu.className = 'context-menu';
    menu.innerHTML = `
      <button data-action="insert-above">Insert Above</button>
      <button data-action="insert-below">Insert Below</button>
      <div class="context-menu-divider"></div>
      <div class="context-submenu">
        <button class="context-submenu-trigger">Insert Period Break ▸</button>
        <div class="context-submenu-content">
          <button data-action="break-ht">⏸ Half Time</button>
          <button data-action="break-ft">⏸ Full Time</button>
          <button data-action="break-ht-added">⏸ Half Time - Added</button>
          <button data-action="break-ft-added">⏸ Full Time - Added</button>
        </div>
      </div>
      <div class="context-menu-divider"></div>
      <button data-action="move-top" ${index === 0 ? 'disabled' : ''}>Move to Top</button>
      <button data-action="move-bottom" ${index === entries.length - 1 ? 'disabled' : ''}>Move to Bottom</button>
      <div class="context-menu-divider"></div>
      <button data-action="delete" class="danger">Delete Entry</button>
    `;

    // Position menu
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);

    // Adjust if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';

    // Handle clicks
    menu.addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      if (!action) return;
      menu.remove();

      switch (action) {
        case 'insert-above':
          await insertEntryAt(index);
          break;
        case 'insert-below':
          await insertEntryAt(index + 1);
          break;
        case 'move-top':
          if (index > 0) {
            const [item] = entries.splice(index, 1);
            entries.unshift(item);
            entries.forEach((ent, i) => ent.order = i);
            await Storage.saveEntries(App.getActiveSheetId(), entries);
            renderPage(document.getElementById('page-container'));
            App.showToast('Entry moved to top', 'info');
          }
          break;
        case 'move-bottom':
          if (index < entries.length - 1) {
            const [item] = entries.splice(index, 1);
            entries.push(item);
            entries.forEach((ent, i) => ent.order = i);
            await Storage.saveEntries(App.getActiveSheetId(), entries);
            renderPage(document.getElementById('page-container'));
            App.showToast('Entry moved to bottom', 'info');
          }
          break;
        case 'break-ht':
          await insertBreakAt(index + 1, 'HALF TIME');
          break;
        case 'break-ft':
          await insertBreakAt(index + 1, 'FULL TIME');
          break;
        case 'break-ht-added':
          await insertBreakAt(index + 1, 'HALF TIME - ADDED');
          break;
        case 'break-ft-added':
          await insertBreakAt(index + 1, 'FULL TIME - ADDED');
          break;
        case 'delete':
          Modal.confirm({
            title: 'Delete Entry',
            message: 'Are you sure you want to delete this entry?',
            confirmLabel: 'Delete',
            confirmClass: 'btn-danger',
            onConfirm: async () => {
              entries = entries.filter(e => e.id !== entryId);
              await Storage.saveEntries(App.getActiveSheetId(), entries);
              await App.refreshActiveSheet();
              renderPage(document.getElementById('page-container'));
              App.showToast('Entry deleted', 'success');
            },
          });
          break;
      }
    });

    // Close on click outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  /**
   * Handle Tab navigation within entry rows
   */
  function handleTabNavigation(e) {
    if (e.key !== 'Tab') return;

    const entryId = e.target.dataset.entryId;
    const field = e.target.dataset.field;

    if (e.shiftKey) {
      // Shift+Tab: go backwards — Comment→Time, Time→Comment (wrap)
      if (field === 'comment') {
        e.preventDefault();
        const timeInput = document.querySelector(`.entry-time-input[data-entry-id="${entryId}"]`);
        if (timeInput) timeInput.focus();
      } else if (field === 'time') {
        e.preventDefault();
        const commentInput = document.querySelector(`.entry-comment-input[data-entry-id="${entryId}"]`);
        if (commentInput) commentInput.focus();
      }
    } else {
      // Tab: go forward — Time→Comment, Comment→Time (wrap)
      if (field === 'time') {
        e.preventDefault();
        const commentInput = document.querySelector(`.entry-comment-input[data-entry-id="${entryId}"]`);
        if (commentInput) commentInput.focus();
      } else if (field === 'comment') {
        e.preventDefault();
        const timeInput = document.querySelector(`.entry-time-input[data-entry-id="${entryId}"]`);
        if (timeInput) timeInput.focus();
      }
    }
  }

  function setupAutoExpand() {
    // Auto-expand all textareas on load
    document.querySelectorAll('.entry-comment-input').forEach(autoExpandTextarea);

    // Handle Tab from tag inputs — stay in same row (wrap to Time)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const target = e.target;
        if (target.matches && target.matches('[data-tag-input]')) {
          const wrapper = target.closest('.tag-input-wrapper');
          if (wrapper) {
            const td = wrapper.closest('td');
            const tr = td?.closest('tr');
            if (tr) {
              e.preventDefault();
              if (e.shiftKey) {
                // Shift+Tab: go to Comment in same row
                const commentInput = tr.querySelector('.entry-comment-input');
                if (commentInput) commentInput.focus();
              } else {
                // Tab: wrap back to Time in same row
                const timeInput = tr.querySelector('.entry-time-input');
                if (timeInput) timeInput.focus();
              }
            }
          }
        }
      }
    });
  }

  /**
   * Auto-expand a textarea to fit its content
   */
  function autoExpandTextarea(el) {
    // contenteditable divs expand naturally — just ensure no height constraint
    el.style.height = '';
    el.style.overflow = 'visible';
  }

  /**
   * Highlight rows for the current audio file
   */
  function highlightCurrentFileRows() {
    const currentFile = AudioPlayer.getCurrentFile();
    document.querySelectorAll('.entry-table tbody tr').forEach((row) => {
      const entryId = row.dataset.entryId;
      const entry = entries.find(e => e.id === entryId);
      const isActive = currentFile && entry?.linkedFiles?.includes(currentFile);
      row.classList.toggle('active-file-row', !!isActive);
    });

    // Update per-file badges
    document.querySelectorAll('.entry-file-badge[data-file-path]').forEach((badge) => {
      const isActive = currentFile && badge.dataset.filePath === currentFile;
      badge.classList.toggle('is-playing', !!isActive);
    });
  }

  /**
   * Scroll table to entries for a specific file
   */
  function scrollToFileEntries(filePath) {
    const entry = entries.find(e => e.linkedFiles?.includes(filePath));
    if (entry) {
      const row = document.querySelector(`tr[data-entry-id="${entry.id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Focus the time input
        const timeInput = row.querySelector('.entry-time-input');
        if (timeInput) timeInput.focus();
      }
    }
  }

  /**
   * Add a manual entry
   */
  async function addManualEntry() {
    const currentFile = AudioPlayer.getCurrentFile();
    const newEntry = {
      id: Storage.generateId(),
      time: '',
      comment: '',
      tags: [],
      included: true,
      linkedFiles: currentFile ? [currentFile] : [],
      order: entries.length,
    };

    entries.push(newEntry);
    await Storage.saveEntries(App.getActiveSheetId(), entries);
    await App.refreshActiveSheet();
    renderPage(document.getElementById('page-container'));

    // Focus the new entry's time input
    setTimeout(() => {
      const timeInput = document.querySelector(`.entry-time-input[data-entry-id="${newEntry.id}"]`);
      if (timeInput) {
        timeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        timeInput.focus();
      }
    }, 50);
  }

  /**
   * Move an entry up or down
   */
  async function moveEntry(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= entries.length) return;

    [entries[index], entries[newIndex]] = [entries[newIndex], entries[index]];

    // Update order
    entries.forEach((e, i) => e.order = i);

    await Storage.saveEntries(App.getActiveSheetId(), entries);
    renderPage(document.getElementById('page-container'));
  }

  /**
   * Show link files modal
   */
  function showLinkFilesModal(entryId) {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    let listHtml = '<ul class="link-files-list">';
    audioFiles.forEach((file) => {
      const fileName = AudioPlayer.getFileName(file);
      const isLinked = entry.linkedFiles?.includes(file);
      listHtml += `
        <li>
          <label>
            <input type="checkbox" value="${file}" ${isLinked ? 'checked' : ''}>
            ${fileName}
          </label>
        </li>
      `;
    });
    listHtml += '</ul>';

    Modal.show({
      title: 'Link Audio Files',
      body: `
        <p style="color: var(--text-secondary); margin-bottom: var(--space-md); font-size: var(--font-size-sm);">
          Select which audio files are associated with this incident.
        </p>
        ${listHtml}
        <div style="margin-top: var(--space-sm); border-top: 1px solid var(--border); padding-top: var(--space-sm);">
          <button class="btn btn-ghost btn-sm" id="btn-clear-links" style="color: var(--danger); font-size: 11px;">
            ✕ Clear All Links
          </button>
        </div>
      `,
      buttons: [
        { label: 'Cancel', class: 'btn-secondary', onClick: () => Modal.hide() },
        {
          label: 'Save',
          class: 'btn-primary',
          onClick: async () => {
            const checkboxes = document.querySelectorAll('.link-files-list input[type="checkbox"]');
            const newLinkedFiles = [];
            checkboxes.forEach((cb) => {
              if (cb.checked) newLinkedFiles.push(cb.value);
            });

            // Find files that were newly linked (not previously linked)
            const previouslyLinked = entry.linkedFiles || [];
            const newlyLinked = newLinkedFiles.filter(f => !previouslyLinked.includes(f));

            entry.linkedFiles = newLinkedFiles;

            // Remove orphan entries — entries for newly linked files that have no user content
            if (newlyLinked.length > 0) {
              entries = entries.filter(e => {
                if (e.id === entry.id) return true; // keep current entry
                // Check if this entry's only linked file was just linked to our entry
                const hasOnlyNewlyLinkedFile = e.linkedFiles && e.linkedFiles.length === 1
                  && newlyLinked.includes(e.linkedFiles[0]);
                const hasNoContent = (!e.time || !e.time.trim()) && (!e.comment || !e.comment.trim());
                // Remove if it's a no-content entry whose file was just linked elsewhere
                return !(hasOnlyNewlyLinkedFile && hasNoContent);
              });
            }

            // Restore entries for files that were unlinked and now have no entry
            const unlinkedFiles = previouslyLinked.filter(f => !newLinkedFiles.includes(f));
            for (const file of unlinkedFiles) {
              // Check if any other entry still references this file
              const stillReferenced = entries.some(e => e.linkedFiles?.includes(file));
              if (!stillReferenced && audioFiles.includes(file)) {
                // Create a new blank entry for this file
                entries.push({
                  id: Storage.generateId(),
                  time: '',
                  comment: '',
                  tags: [],
                  included: true,
                  linkedFiles: [file],
                  order: entries.length,
                });
              }
            }

            await Storage.saveEntries(App.getActiveSheetId(), entries);
            await App.refreshActiveSheet();
            Modal.hide();
            renderPage(document.getElementById('page-container'));
          },
        },
      ],
    });

    // Bind Clear All Links button and scroll to first checked item
    setTimeout(() => {
      document.getElementById('btn-clear-links')?.addEventListener('click', () => {
        document.querySelectorAll('.link-files-list input[type="checkbox"]').forEach(cb => {
          cb.checked = false;
        });
      });

      // Scroll the list so the first already-checked file sits at the top,
      // revealing the following files below it for context
      const linkList = document.querySelector('.link-files-list');
      const firstChecked = linkList?.querySelector('input[type="checkbox"]:checked');
      if (linkList && firstChecked) {
        const li = firstChecked.closest('li');
        const liTop = li.getBoundingClientRect().top - linkList.getBoundingClientRect().top;
        linkList.scrollTop += liTop;
      }
    }, 50);
  }

  /**
   * Debounced autosave
   */
  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      await Storage.saveEntries(App.getActiveSheetId(), entries);
    }, 300);
  }

  /**
   * Flush pending saves immediately (called before navigation)
   */
  async function flushSave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      if (entries.length > 0 && App.getActiveSheetId()) {
        await Storage.saveEntries(App.getActiveSheetId(), entries);
      }
    }
  }

  /**
   * Select the word under right-click BEFORE Chromium builds context-menu params,
   * so params.misspelledWord and params.dictionarySuggestions are populated.
   */
  function initSpellCheckContextMenu() {
    document.querySelectorAll('.entry-comment-input').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 2) return; // right-click only
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) return;
        const sel = window.getSelection();
        sel.removeAllRanges();
        range.expand('word');
        sel.addRange(range);
      });
    });
  }

  return { render, flushSave, setTimeAdjustHotkeys };
})();
