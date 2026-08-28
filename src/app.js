/**
 * App Controller
 * Main application logic — navigation, state management, toast notifications.
 */
const App = (() => {
    let currentPage = 'manager';
    let activeSheet = null; // { metadata, audioFiles, entries, tags }
    let activeSheetId = null;

    const pages = {
        manager: ManagerPage,
        transcribe: TranscribePage,
        review: ReviewPage,
        export: ExportPage,
    };

    /**
     * Initialize the application
     */
    async function init() {
        await Storage.init();
        AudioPlayer.init();
        UndoRedo.init();
        await loadHotkeySettings();
        await loadSpellCheckerLanguage();
        bindNavigation();
        await navigateTo('manager');
        // Check for updates silently in background
        checkForUpdates(false);
    }

    /**
     * Bind navigation tab clicks
     */
    function bindNavigation() {
        document.querySelectorAll('.nav-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                if (tab.disabled) return;
                const page = tab.dataset.page;
                navigateTo(page);
            });
        });
    }

    /**
     * Navigate to a page
     */
    async function navigateTo(pageName) {
        currentPage = pageName;

        // Update nav tabs
        document.querySelectorAll('.nav-tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.page === pageName);
        });

        // Flush any pending saves from the current page before switching
        if (typeof TranscribePage !== 'undefined' && TranscribePage.flushSave) {
            await TranscribePage.flushSave();
        }
        if (typeof ReviewPage !== 'undefined' && ReviewPage.flushSave) {
            await ReviewPage.flushSave();
        }

        // Refresh sheet data from disk before rendering (syncs between modules)
        if (activeSheetId && pageName !== 'manager') {
            await refreshActiveSheet();
        }

        // Render page
        const container = document.getElementById('page-container');
        const page = pages[pageName];

        // Show/hide the bottom audio player bar (only visible on Transcribe)
        if (pageName !== 'transcribe') {
            AudioPlayer.hidePlayerBar();
        }

        if (page) {
            await page.render(container);
        }

        // Update status bar
        updateStatus();
    }

    /**
     * Open a running sheet — loads data and enables other tabs
     */
    async function openRunningSheet(sheetId) {
        try {
            activeSheetId = sheetId;
            activeSheet = await Storage.openRunningSheet(sheetId);
            UndoRedo.clear();

            // Enable navigation tabs
            document.getElementById('nav-transcribe').disabled = false;
            document.getElementById('nav-review').disabled = false;
            document.getElementById('nav-export').disabled = false;

            // Update status
            updateStatus();

            // Check for broken audio paths
            const broken = [];
            for (const filePath of (activeSheet.audioFiles || [])) {
                const exists = await window.api.fs.exists(filePath);
                if (!exists) broken.push(filePath);
            }

            // Navigate to transcribe module
            await navigateTo('transcribe');

            // Prompt to resolve any broken audio paths after render
            if (broken.length > 0) {
                TranscribePage.promptResolveFiles(broken);
            }

            const label = activeSheet.metadata.homeTeam && activeSheet.metadata.awayTeam
                ? `${activeSheet.metadata.homeTeam} vs ${activeSheet.metadata.awayTeam}`
                : 'Untitled Match';
            showToast(`Opened: ${label}`, 'info');
        } catch (e) {
            console.error('Failed to open running sheet:', e);
            showToast('Failed to open running sheet', 'error');
        }
    }

    /**
     * Close the active running sheet
     */
    function closeRunningSheet() {
        activeSheet = null;
        activeSheetId = null;

        // Disable navigation tabs
        document.getElementById('nav-transcribe').disabled = true;
        document.getElementById('nav-review').disabled = true;
        document.getElementById('nav-export').disabled = true;

        updateStatus();
        navigateTo('manager');
    }

    /**
     * Get the active sheet data
     */
    function getActiveSheet() {
        return activeSheet;
    }

    function getActiveSheetId() {
        return activeSheetId;
    }

    /**
     * Refresh active sheet data from disk
     */
    async function refreshActiveSheet() {
        if (activeSheetId) {
            activeSheet = await Storage.openRunningSheet(activeSheetId);
        }
        return activeSheet;
    }

    /**
     * Update the nav bar status text
     */
    function updateStatus() {
        const statusEl = document.getElementById('nav-status');
        if (activeSheet) {
            const label = activeSheet.metadata.homeTeam && activeSheet.metadata.awayTeam
                ? `${activeSheet.metadata.homeTeam} vs ${activeSheet.metadata.awayTeam}`
                : 'Untitled Match';
            statusEl.textContent = label;
            statusEl.style.color = 'var(--accent)';
        } else {
            statusEl.textContent = '';
        }
    }

    /**
     * Show a toast notification
     */
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'fadeOut 300ms ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    /**
     * Show Edit File Details modal (accessible from any module)
     */
    function showEditDetails() {
        if (!activeSheet) {
            showToast('No running sheet open', 'error');
            return;
        }
        const meta = activeSheet.metadata;
        const formHtml = `
            <div class="metadata-form">
              <div class="input-group">
                <label class="input-label" for="edit-match-date">Match Date${!meta.matchDate ? ' <span class="required">*</span>' : ''}</label>
                <input type="date" class="input" id="edit-match-date" value="${meta.matchDate || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-competition">Competition / Division${!meta.competition ? ' <span class="required">*</span>' : ''}</label>
                <input type="text" class="input" id="edit-competition" value="${meta.competition || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-home-team">Home Team${!meta.homeTeam ? ' <span class="required">*</span>' : ''}</label>
                <input type="text" class="input" id="edit-home-team" value="${meta.homeTeam || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-away-team">Away Team${!meta.awayTeam ? ' <span class="required">*</span>' : ''}</label>
                <input type="text" class="input" id="edit-away-team" value="${meta.awayTeam || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-venue">Venue${!meta.venue ? ' <span class="required">*</span>' : ''}</label>
                <input type="text" class="input" id="edit-venue" value="${meta.venue || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-referee">Referee${!meta.referee ? ' <span class="required">*</span>' : ''}</label>
                <input type="text" class="input" id="edit-referee" value="${meta.referee || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-ar1">Assistant Referee 1</label>
                <input type="text" class="input" id="edit-ar1" value="${meta.ar1 || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-ar2">Assistant Referee 2</label>
                <input type="text" class="input" id="edit-ar2" value="${meta.ar2 || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-fourth">Fourth Official</label>
                <input type="text" class="input" id="edit-fourth" value="${meta.fourthOfficial || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-var">VAR</label>
                <input type="text" class="input" id="edit-var" value="${meta.var || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-avar">AVAR</label>
                <input type="text" class="input" id="edit-avar" value="${meta.avar || ''}">
              </div>
              <div class="input-group">
                <label class="input-label" for="edit-reserve-ar">Reserve Assistant Referee</label>
                <input type="text" class="input" id="edit-reserve-ar" value="${meta.reserveAr || ''}">
              </div>
            </div>
        `;

        Modal.show({
            title: 'Edit File Details',
            body: formHtml,
            width: '600px',
            buttons: [
                { label: 'Cancel', class: 'btn-secondary', onClick: () => Modal.hide() },
                {
                    label: 'Save',
                    class: 'btn-primary',
                    onClick: async () => {
                        const updated = {
                            ...meta,
                            matchDate: document.getElementById('edit-match-date')?.value || '',
                            homeTeam: document.getElementById('edit-home-team')?.value?.trim() || '',
                            awayTeam: document.getElementById('edit-away-team')?.value?.trim() || '',
                            venue: document.getElementById('edit-venue')?.value?.trim() || '',
                            competition: document.getElementById('edit-competition')?.value?.trim() || '',
                            referee: document.getElementById('edit-referee')?.value?.trim() || '',
                            fourthOfficial: document.getElementById('edit-fourth')?.value?.trim() || '',
                            ar1: document.getElementById('edit-ar1')?.value?.trim() || '',
                            ar2: document.getElementById('edit-ar2')?.value?.trim() || '',
                            var: document.getElementById('edit-var')?.value?.trim() || '',
                            avar: document.getElementById('edit-avar')?.value?.trim() || '',
                            reserveAr: document.getElementById('edit-reserve-ar')?.value?.trim() || '',
                        };
                        await Storage.saveMetadata(activeSheetId, updated);
                        activeSheet.metadata = updated;
                        updateStatus();
                        Modal.hide();
                        showToast('File details saved', 'success');
                    },
                },
            ],
        });
    }

    /**
     * Load saved hotkeys from settings
     */
    async function loadHotkeySettings() {
        const settings = await window.api.settings.get();
        if (settings && settings.hotkeys) {
            AudioPlayer.setHotkeys(settings.hotkeys);
        }
        if (settings && settings.timeAdjustHotkeys) {
            TranscribePage.setTimeAdjustHotkeys(settings.timeAdjustHotkeys);
        }
    }

    /**
     * Load saved spell checker language from settings and apply it
     */
    async function loadSpellCheckerLanguage() {
        const settings = await window.api.settings.get();
        const lang = settings?.spellCheckerLanguage || 'en-AU';
        await window.api.app.setSpellCheckerLanguage(lang);
    }

    /**
     * Show settings modal
     */
    async function showSettings(activeTab = 'general') {
        const hotkeys = AudioPlayer.getHotkeys();
        const retentionDays = await Storage.getRetentionDays();
        const settings = await window.api.settings.get();
        const currentLang = settings?.spellCheckerLanguage || 'en-AU';
        const timeHotkeys = settings?.timeAdjustHotkeys || { add: 'PageUp', subtract: 'PageDown' };

        const spellLanguages = [
            { code: 'en-AU', label: 'English (Australia)' },
            { code: 'en-CA', label: 'English (Canada)' },
            { code: 'en-NZ', label: 'English (New Zealand)' },
            { code: 'en-ZA', label: 'English (South Africa)' },
            { code: 'en-GB', label: 'English (United Kingdom)' },
            { code: 'en-US', label: 'English (United States)' },
        ];

        const hotkeyRows = [
            { id: 'prevFile', label: 'Previous File', key: hotkeys.prevFile },
            { id: 'togglePlayPause', label: 'Play / Pause', key: hotkeys.togglePlayPause },
            { id: 'stop', label: 'Stop', key: hotkeys.stop },
            { id: 'nextFile', label: 'Next File', key: hotkeys.nextFile },
        ];

        const hotkeyHtml = hotkeyRows.map(row => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-light);">
                <span style="font-size:var(--font-size-sm);">${row.label}</span>
                <button class="hotkey-capture-btn" data-action="${row.id}"
                        style="min-width:80px; padding:6px 14px; background:var(--bg-tertiary); border:1px solid var(--border);
                               border-radius:var(--radius-sm); color:var(--text-primary); font-family:var(--font-mono);
                               font-size:var(--font-size-sm); cursor:pointer; text-align:center; transition: all 0.15s;">
                    ${row.key}
                </button>
            </div>
        `).join('');

        Modal.show({
            title: 'Settings',
            body: `
                <div class="settings-tabs">
                    <button class="settings-tab active" data-tab="general">General</button>
                    <button class="settings-tab" data-tab="hotkeys">Hotkeys</button>
                </div>

                <!-- General Tab -->
                <div class="settings-tab-panel" id="settings-panel-general">
                    <div style="margin-bottom:var(--space-lg);">
                        <h3 style="font-size:var(--font-size-sm); color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:var(--space-sm);">
                            Storage Directory
                        </h3>
                        <div style="display:flex; align-items:center; gap:8px; padding:8px 0;">
                            <span id="settings-storage-path" style="flex:1; font-size:var(--font-size-sm); color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${Storage.getRootDir() || 'Not set'}</span>
                            <button class="btn btn-ghost btn-sm" id="settings-change-dir" style="flex-shrink:0;">Change</button>
                        </div>
                    </div>
                    <div style="margin-bottom:var(--space-lg);">
                        <h3 style="font-size:var(--font-size-sm); color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:var(--space-sm);">
                            Spell Check Language
                        </h3>
                        <div style="display:flex; align-items:center; gap:8px; padding:8px 0;">
                            <select id="settings-spell-language"
                                    style="flex:1; padding:6px 10px; background:var(--bg-tertiary); border:1px solid var(--border);
                                           border-radius:var(--radius-sm); color:var(--text-primary); font-size:var(--font-size-sm);">
                                ${spellLanguages.map(l => `<option value="${l.code}" ${l.code === currentLang ? 'selected' : ''}>${l.label}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div style="margin-bottom:var(--space-lg);">
                        <h3 style="font-size:var(--font-size-sm); color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:var(--space-sm);">
                            Completed Sheets
                        </h3>
                        <div style="display:flex; align-items:center; gap:8px; padding:8px 0;">
                            <span style="font-size:var(--font-size-sm); color:var(--text-secondary); flex:1;">Auto-delete after</span>
                            <input type="number" id="settings-retention-days" min="1" max="365" value="${retentionDays}"
                                   style="width:64px; padding:4px 8px; background:var(--bg-tertiary); border:1px solid var(--border);
                                          border-radius:var(--radius-sm); color:var(--text-primary); font-size:var(--font-size-sm); text-align:center;">
                            <span style="font-size:var(--font-size-sm); color:var(--text-secondary);">days after completion</span>
                        </div>
                    </div>
                </div>

                <!-- Hotkeys Tab -->
                <div class="settings-tab-panel hidden" id="settings-panel-hotkeys">
                    <div style="margin-bottom:var(--space-lg);">
                        <h3 style="font-size:var(--font-size-sm); color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:var(--space-sm);">
                            Audio Hotkeys
                        </h3>
                        <p style="font-size:var(--font-size-xs); color:var(--text-tertiary); margin-bottom:var(--space-sm);">
                            Click a key button, then press the new key to assign it.
                        </p>
                        ${hotkeyHtml}
                    </div>
                    <div style="margin-bottom:var(--space-lg);">
                        <h3 style="font-size:var(--font-size-sm); color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:var(--space-sm);">
                            Time Adjust Hotkeys
                        </h3>
                        <p style="font-size:var(--font-size-xs); color:var(--text-tertiary); margin-bottom:var(--space-sm);">
                            Click a key button, then press the new key to assign it.
                        </p>
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-light);">
                            <span style="font-size:var(--font-size-sm);">Add Time</span>
                            <button class="hotkey-capture-btn" data-action="timeAdjustAdd"
                                    style="min-width:80px; padding:6px 14px; background:var(--bg-tertiary); border:1px solid var(--border);
                                           border-radius:var(--radius-sm); color:var(--text-primary); font-family:var(--font-mono);
                                           font-size:var(--font-size-sm); cursor:pointer; text-align:center; transition: all 0.15s;">
                                ${timeHotkeys.add}
                            </button>
                        </div>
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-light);">
                            <span style="font-size:var(--font-size-sm);">Subtract Time</span>
                            <button class="hotkey-capture-btn" data-action="timeAdjustSubtract"
                                    style="min-width:80px; padding:6px 14px; background:var(--bg-tertiary); border:1px solid var(--border);
                                           border-radius:var(--radius-sm); color:var(--text-primary); font-family:var(--font-mono);
                                           font-size:var(--font-size-sm); cursor:pointer; text-align:center; transition: all 0.15s;">
                                ${timeHotkeys.subtract}
                            </button>
                        </div>
                    </div>
                </div>
            `,
            buttons: [
                {
                    label: 'Reset Defaults',
                    className: 'btn btn-ghost',
                    onClick: () => {
                        Modal.confirm({
                            title: 'Reset All Hotkeys',
                            message: 'This will restore all hotkeys to their default assignments. Any custom assignments will be lost. Continue?',
                            confirmLabel: 'Reset',
                            confirmClass: 'btn-danger',
                            onConfirm: async () => {
                                const audioDefaults = {
                                    prevFile: 'F1',
                                    togglePlayPause: 'F2',
                                    stop: 'F3',
                                    nextFile: 'F4',
                                };
                                const timeDefaults = { add: 'PageUp', subtract: 'PageDown' };

                                AudioPlayer.setHotkeys(audioDefaults);
                                saveHotkeySettings();

                                // Reset time adjust hotkeys
                                const settings = await window.api.settings.get() || {};
                                settings.timeAdjustHotkeys = timeDefaults;
                                await window.api.settings.set(settings);
                                TranscribePage.setTimeAdjustHotkeys(timeDefaults);

                                AudioPlayer.showPlayerBar();
                                showToast('Hotkeys reset to defaults', 'info');

                                // Reopen settings to show the restored values
                                showSettings('hotkeys');
                            },
                        });
                    },
                },
                {
                    label: 'Done',
                    className: 'btn btn-primary',
                    onClick: () => Modal.close(),
                },
            ],
        });

        // Bind tab switching
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.add('hidden'));
                tab.classList.add('active');
                document.getElementById(`settings-panel-${tab.dataset.tab}`)?.classList.remove('hidden');
                // Show Reset Defaults only on Hotkeys tab
                const resetBtn = document.getElementById('modal-btn-0');
                if (resetBtn) resetBtn.style.display = tab.dataset.tab === 'hotkeys' ? '' : 'none';
            });
        });

        // Activate the requested tab
        if (activeTab !== 'general') {
            document.querySelector(`.settings-tab[data-tab="${activeTab}"]`)?.click();
        } else {
            // Hide Reset Defaults on initial General tab load
            const resetBtn = document.getElementById('modal-btn-0');
            if (resetBtn) resetBtn.style.display = 'none';
        }

        // Bind storage directory change button
        document.getElementById('settings-change-dir')?.addEventListener('click', async () => {
            const dir = await window.api.dialog.selectDirectory('Select Storage Folder for Running Sheets');
            if (dir) {
                await Storage.setRootDir(dir);
                document.getElementById('settings-storage-path').textContent = dir;
                showToast('Storage folder updated', 'success');
                // Close any active sheet and refresh manager
                closeRunningSheet();
                Modal.hide();
            }
        });

        // Bind hotkey capture buttons
        document.querySelectorAll('.hotkey-capture-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.textContent = 'Press a key...';
                btn.style.borderColor = 'var(--accent)';
                btn.style.boxShadow = '0 0 0 2px var(--accent-dim)';

                function onKey(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const newKey = e.key;

                    btn.textContent = newKey;
                    btn.style.borderColor = '';
                    btn.style.boxShadow = '';

                    if (action === 'timeAdjustAdd' || action === 'timeAdjustSubtract') {
                        // Save time adjust hotkeys
                        saveTimeAdjustHotkeySetting(action, newKey);
                    } else {
                        // Update audio hotkey map
                        const update = {};
                        update[action] = newKey;
                        AudioPlayer.setHotkeys(update);
                        saveHotkeySettings();
                        AudioPlayer.showPlayerBar();
                    }

                    document.removeEventListener('keydown', onKey, true);
                }

                document.addEventListener('keydown', onKey, true);
            });
        });

        // Bind retention days input
        document.getElementById('settings-retention-days')?.addEventListener('change', async (e) => {
            const val = parseInt(e.target.value, 10);
            if (val && val >= 1) {
                await Storage.setRetentionDays(val);
            }
        });

        // Bind spell check language selector
        document.getElementById('settings-spell-language')?.addEventListener('change', async (e) => {
            const langCode = e.target.value;
            const settings = await window.api.settings.get() || {};
            settings.spellCheckerLanguage = langCode;
            await window.api.settings.set(settings);
            await window.api.app.setSpellCheckerLanguage(langCode);
            showToast(`Spell check language set to ${e.target.options[e.target.selectedIndex].text}`, 'success');
        });
    }

    /**
     * Save hotkey settings to disk
     */
    async function saveHotkeySettings() {
        const settings = await window.api.settings.get() || {};
        settings.hotkeys = AudioPlayer.getHotkeys();
        await window.api.settings.set(settings);
    }

    async function saveTimeAdjustHotkeySetting(action, key) {
        const settings = await window.api.settings.get() || {};
        if (!settings.timeAdjustHotkeys) {
            settings.timeAdjustHotkeys = { add: 'PageUp', subtract: 'PageDown' };
        }
        if (action === 'timeAdjustAdd') settings.timeAdjustHotkeys.add = key;
        if (action === 'timeAdjustSubtract') settings.timeAdjustHotkeys.subtract = key;
        await window.api.settings.set(settings);
        TranscribePage.setTimeAdjustHotkeys(settings.timeAdjustHotkeys);
    }

    /**
     * Check GitHub for a newer version
     * @param {boolean} manual - if true, always show a result dialog; if false, only show if update found
     */
    async function checkForUpdates(manual = true) {
        const result = await window.api.app.checkForUpdates();

        if (result.error) {
            if (manual) showToast('Could not check for updates — check your internet connection', 'error');
            return;
        }

        if (result.hasUpdate) {
            Modal.confirm({
                title: 'Update Available',
                message: `
                    <div style="text-align:center">
                        <p style="margin-bottom:12px">Version <strong>${result.latestVersion}</strong> is available.</p>
                        <p style="font-size:var(--font-size-sm); color:var(--text-secondary)">You are running <strong>${result.currentVersion}</strong>.</p>
                    </div>`,
                confirmLabel: 'Download Now',
                confirmClass: 'btn-primary',
                onConfirm: () => window.api.app.openExternal(result.downloadUrl),
            });
        } else if (manual) {
            showToast(`You're up to date — v${result.currentVersion}`, 'success');
        }
    }

    /**
     * Show About dialog
     */
    async function showAbout() {
        const version = await window.api.app.getVersion();
        Modal.show({
            title: 'About',
            body: `
                <div style="text-align:center; padding: var(--space-md) 0;">
                    <img src="../assets/icons/icon.png" alt="App Icon"
                         style="width:80px; height:80px; margin-bottom:var(--space-md); border-radius:var(--radius-lg);">
                    <h2 style="font-size:var(--font-size-xl); color:var(--text-primary); font-weight:700; margin-bottom:6px;">
                        Running Sheet Transcriber
                    </h2>
                    <p style="font-size:var(--font-size-sm); color:var(--text-secondary); margin-bottom:var(--space-md);">
                        Version ${version}
                    </p>
                    <p style="font-size:var(--font-size-sm); color:var(--text-secondary); line-height:1.6;">
                        Created for football referee coaches. A desktop tool for creating match running sheets from audio recordings.
                    </p>
                    <div style="margin-top:var(--space-lg); padding-top:var(--space-md); border-top:1px solid var(--border);">
                        <p style="font-size:var(--font-size-sm); color:var(--text-tertiary);">
                            Published by <span style="color:var(--accent); font-weight:600;">JarlOfSunAndRain</span>
                        </p>
                        <p style="font-size:var(--font-size-xs); color:var(--text-tertiary); margin-top:6px;">
                            Licensed under AGPL-3.0 &nbsp;·&nbsp;
                            <a href="#" id="about-github-link" style="color:var(--accent); text-decoration:none;">GitHub</a>
                        </p>
                    </div>
                </div>
            `,
            width: '400px',
            buttons: [
                { label: 'Close', class: 'btn-primary', onClick: () => Modal.hide() },
            ],
        });

        // Bind buttons after modal renders
        setTimeout(() => {
            document.getElementById('about-github-link')?.addEventListener('click', (e) => {
                e.preventDefault();
                window.api.app.openExternal('https://github.com/JarlOfSunAndRain/RunningSheetTranscriber');
            });
        }, 50);
    }

    /**
     * Show Version History dialog
     */
    function showVersionHistory() {
        Modal.show({
            title: 'Version History',
            body: `
                <div style="max-height:480px; overflow-y:auto; padding-right:4px;">

                    <div style="margin-bottom:var(--space-lg);">
                        <p style="font-size:var(--font-size-sm); font-weight:700; color:var(--text-primary); margin-bottom:4px;">v1.1.1</p>
                        <ul style="font-size:var(--font-size-sm); color:var(--text-secondary); padding-left:var(--space-md); line-height:1.8; margin:0;">
                            <li>Corrected GUID fix note from last patch in update history.</li>
                            <li>Line numbers added to transcription rows in the transcribe module to identify linked audio file positions.</li>
                            <li>Added audio file verification when opening a sheet — missing files are detected and a prompt is shown to locate and re-link them from a new folder.</li>
                            <li>General security and functionality fixes.</li>
                            <li>Upgraded electron-builder to v26.15.3.</li>
                        </ul>
                    </div>

                    <div style="margin-bottom:var(--space-lg);">
                        <p style="font-size:var(--font-size-sm); font-weight:700; color:var(--text-primary); margin-bottom:4px;">v1.1.0</p>
                        <ul style="font-size:var(--font-size-sm); color:var(--text-secondary); padding-left:var(--space-md); line-height:1.8; margin:0;">
                            <li>Fixed the GUID to allow updates of the app to update old listings as new version in operating systems to avoid old version entries on the app listings after installing updates.</li>
                            <li>Added a full version by version patch notes section within the app.</li>
                            <li>Revised the About splash screen description.</li>
                            <li>Changed the about button to a drop down menu to include update, version history and update selections.</li>
                            <li>Added Time adjustment variable options and functionality to the "Time" field in the transcribe module. Also added hotkey assignments for this feature to function.</li>
                            <li>Removed the "back to manager" button in the transcribe module (redundant).</li>
                            <li>Revised the settings menu to improve organisation and better place the reset to default buttons in context.</li>
                        </ul>
                    </div>

                    <div style="margin-bottom:var(--space-lg);">
                        <p style="font-size:var(--font-size-sm); font-weight:700; color:var(--text-primary); margin-bottom:4px;">v1.0.2</p>
                        <ul style="font-size:var(--font-size-sm); color:var(--text-secondary); padding-left:var(--space-md); line-height:1.8; margin:0;">
                            <li>Linking files in the transcribe module now has auto scroll to the selected file in link file dialog to aid user in linking files quickly.</li>
                            <li>Clearing a line in the transcribe module now resets the entry to "null" so it will not be listed in the review module. The guide shadow text is also reset after clearing the field.</li>
                            <li>The review module now includes a validity check to exclude lines of the sheet. KMI's and IOI's will no longer be able to be excluded. Also if excluded lines have KMI or IOI highlighting added they will automatically be included when adding highlighting.</li>
                            <li>Preview export text in the Publish module has been reduced in scale to more accurately reflect export sizes.</li>
                        </ul>
                    </div>

                    <div style="margin-bottom:var(--space-lg);">
                        <p style="font-size:var(--font-size-sm); font-weight:700; color:var(--text-primary); margin-bottom:4px;">v1.0.1</p>
                        <ul style="font-size:var(--font-size-sm); color:var(--text-secondary); padding-left:var(--space-md); line-height:1.8; margin:0;">
                            <li>Spell checker/copy/cut/paste for right click functionality now operates with right click in "note/incident" field for the transcribe and review modules.</li>
                            <li>Automatic update checker added.</li>
                            <li>English language selections added to options — Australia, Canada, New Zealand, South Africa, United Kingdom, United States — to assist with spell checker.</li>
                        </ul>
                    </div>

                    <div>
                        <p style="font-size:var(--font-size-sm); font-weight:700; color:var(--text-primary); margin-bottom:4px;">v1.0.0</p>
                        <ul style="font-size:var(--font-size-sm); color:var(--text-secondary); padding-left:var(--space-md); line-height:1.8; margin:0;">
                            <li>Initial release.</li>
                            <li>Audio playback with F1–F4 hotkeys.</li>
                            <li>Per-file entry editing (time, comment, tags, highlight).</li>
                            <li>Review module with filters, bulk actions and statistics.</li>
                            <li>PDF export.</li>
                            <li>Snapshot-based undo/redo.</li>
                            <li>Auto-save and retention management.</li>
                        </ul>
                    </div>

                </div>
            `,
            width: '520px',
            buttons: [
                { label: 'Close', class: 'btn-primary', onClick: () => Modal.hide() },
            ],
        });
    }

    return {
        init,
        navigateTo,
        openRunningSheet,
        closeRunningSheet,
        getActiveSheet,
        getActiveSheetId,
        refreshActiveSheet,
        showToast,
        showSettings,
        showEditDetails,
        showAbout,
        showVersionHistory,
        checkForUpdates,
    };
})();

// Boot the app
document.addEventListener('DOMContentLoaded', () => {
    App.init();

    // Bind settings button
    document.getElementById('btn-settings')?.addEventListener('click', () => {
        App.showSettings();
    });

    // Bind Edit File Details button
    document.getElementById('btn-edit-details')?.addEventListener('click', () => {
        App.showEditDetails();
    });

    // Bind About dropdown
    const aboutBtn = document.getElementById('btn-about');
    const aboutDropdown = document.getElementById('about-dropdown');
    aboutBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        aboutDropdown.classList.toggle('open');
    });
    document.getElementById('about-menu-about')?.addEventListener('click', () => {
        aboutDropdown.classList.remove('open');
        App.showAbout();
    });
    document.getElementById('about-menu-history')?.addEventListener('click', () => {
        aboutDropdown.classList.remove('open');
        App.showVersionHistory();
    });
    document.getElementById('about-menu-updates')?.addEventListener('click', () => {
        aboutDropdown.classList.remove('open');
        App.checkForUpdates(true);
    });
    document.addEventListener('click', () => {
        aboutDropdown?.classList.remove('open');
    });
});
