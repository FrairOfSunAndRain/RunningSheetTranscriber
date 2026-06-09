/**
 * Audio Player Component
 * Minimal player with play/pause, stop, prev/next file, and looping.
 * Hotkeys F1–F4 work while typing.
 */
const AudioPlayer = (() => {
    let audioEl = null;
    let currentFiles = [];
    let currentIndex = -1;
    let isPlaying = false;
    let onFileChangeCallback = null;

    /**
     * Initialize the audio player
     */
    function init() {
        // Create the hidden audio element
        audioEl = document.createElement('audio');
        audioEl.id = 'audio-player-element';
        audioEl.loop = true; // Loop current file
        audioEl.preload = 'auto';
        document.body.appendChild(audioEl);

        // Bind global hotkeys
        document.addEventListener('keydown', handleHotkey);

        // Track play state
        audioEl.addEventListener('play', () => {
            isPlaying = true;
            updatePlayerUI();
        });

        audioEl.addEventListener('pause', () => {
            isPlaying = false;
            updatePlayerUI();
        });

        audioEl.addEventListener('timeupdate', () => {
            updateProgressUI();
        });

        audioEl.addEventListener('loadedmetadata', () => {
            updatePlayerUI();
        });

        audioEl.addEventListener('error', (e) => {
            const mediaError = audioEl.error;
            let errorMsg = 'Unknown error';
            if (mediaError) {
                switch (mediaError.code) {
                    case 1: errorMsg = 'MEDIA_ERR_ABORTED - Playback aborted'; break;
                    case 2: errorMsg = 'MEDIA_ERR_NETWORK - Network error'; break;
                    case 3: errorMsg = 'MEDIA_ERR_DECODE - Decode error (unsupported format?)'; break;
                    case 4: errorMsg = 'MEDIA_ERR_SRC_NOT_SUPPORTED - Source not supported'; break;
                }
            }
            console.error('Audio error:', errorMsg, '| src:', audioEl.src);
            updatePlayerUI();
        });

        audioEl.addEventListener('canplay', () => {
            console.log('Audio ready to play:', audioEl.src);
        });
    }

    // Configurable hotkey map
    let hotkeyMap = {
        prevFile: 'F1',
        togglePlayPause: 'F2',
        stop: 'F3',
        nextFile: 'F4',
    };

    // Extra hotkey hints rendered at the end of the player bar
    let extraHints = [];  // [{ key, label }, ...]

    /**
     * Handle global hotkeys (uses the configurable map)
     */
    function handleHotkey(e) {
        const key = e.key;
        if (key === hotkeyMap.prevFile) { e.preventDefault(); prevFile(); }
        else if (key === hotkeyMap.togglePlayPause) { e.preventDefault(); togglePlayPause(); }
        else if (key === hotkeyMap.stop) { e.preventDefault(); stop(); }
        else if (key === hotkeyMap.nextFile) { e.preventDefault(); nextFile(); }
    }

    /**
     * Update hotkey bindings
     */
    function setHotkeys(map) {
        if (map) hotkeyMap = { ...hotkeyMap, ...map };
    }

    function getHotkeys() {
        return { ...hotkeyMap };
    }

    function setExtraHints(hints) {
        extraHints = hints || [];
    }

    /**
     * Load a list of audio files
     */
    function loadFiles(files) {
        currentFiles = files || [];
        currentIndex = -1;
        isPlaying = false;

        if (audioEl) {
            audioEl.pause();
            audioEl.src = '';
        }

        if (currentFiles.length > 0) {
            loadFile(0);
        }

        updatePlayerUI();
    }

    /**
     * Load a specific file by index
     */
    async function loadFile(index) {
        if (index < 0 || index >= currentFiles.length) return;

        const prevIndex = currentIndex;
        currentIndex = index;
        const filePath = currentFiles[currentIndex];

        // Get a playable URL (converts WMA etc. to WAV if needed)
        try {
            const fileUrl = await window.api.audio.getPlayableUrl(filePath);
            console.log('Loading audio:', filePath, '->', fileUrl);
            audioEl.src = fileUrl;
            audioEl.load();
        } catch (e) {
            console.error('Failed to get playable URL:', e);
        }

        updatePlayerUI();

        // Notify callback
        if (onFileChangeCallback && prevIndex !== currentIndex) {
            onFileChangeCallback(currentIndex, filePath);
        }
    }

    /**
     * Play / Pause toggle
     */
    async function togglePlayPause() {
        if (!audioEl || currentFiles.length === 0) return;

        if (currentIndex === -1) {
            await loadFile(0);
        }

        if (audioEl.paused) {
            audioEl.play().catch(e => console.error('Play failed:', e));
        } else {
            audioEl.pause();
        }
    }

    /**
     * Stop playback
     */
    function stop() {
        if (!audioEl) return;
        audioEl.pause();
        audioEl.currentTime = 0;
        isPlaying = false;
        updatePlayerUI();
    }

    /**
     * Previous file
     */
    async function prevFile() {
        if (currentFiles.length === 0) return;
        const wasPlaying = isPlaying;
        const newIndex = currentIndex > 0 ? currentIndex - 1 : currentFiles.length - 1;
        await loadFile(newIndex);
        if (wasPlaying) {
            audioEl.play().catch(e => console.error('Play failed:', e));
        }
    }

    /**
     * Next file
     */
    async function nextFile() {
        if (currentFiles.length === 0) return;
        const wasPlaying = isPlaying;
        const newIndex = currentIndex < currentFiles.length - 1 ? currentIndex + 1 : 0;
        await loadFile(newIndex);
        if (wasPlaying) {
            audioEl.play().catch(e => console.error('Play failed:', e));
        }
    }

    /**
     * Jump to a specific file index
     */
    async function goToFile(index) {
        if (index < 0 || index >= currentFiles.length) return;
        const wasPlaying = isPlaying;
        await loadFile(index);
        if (wasPlaying) {
            audioEl.play().catch(e => console.error('Play failed:', e));
        }
    }

    /**
     * Set callback for file changes
     */
    function onFileChange(callback) {
        onFileChangeCallback = callback;
    }

    /**
     * Get the filename from a path
     */
    function getFileName(filePath) {
        if (!filePath) return '';
        return filePath.split('\\').pop().split('/').pop();
    }

    /**
     * Format seconds as MM:SS
     */
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * Render the player bar HTML
     */
    function renderPlayerBar() {
        const currentFile = currentIndex >= 0 ? getFileName(currentFiles[currentIndex]) : '—';
        const fileCounter = currentFiles.length > 0
            ? `${currentIndex + 1} / ${currentFiles.length}`
            : '0 / 0';

        return `
      <div class="audio-player-bar" id="audio-player-bar">
        <div class="player-file-info">
          <span class="player-file-counter">${fileCounter}</span>
          <span class="player-file-name" id="player-file-name" title="${currentIndex >= 0 ? currentFiles[currentIndex] : ''}">${currentFile}</span>
        </div>

        <div class="player-controls">
          <button class="player-btn" id="player-btn-prev" title="Previous File (${hotkeyMap.prevFile})">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z"/></svg>
          </button>
          <button class="player-btn player-btn-main" id="player-btn-play" title="Play / Pause (${hotkeyMap.togglePlayPause})">
            ${isPlaying
                ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
                : '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
            }
          </button>
          <button class="player-btn" id="player-btn-stop" title="Stop (${hotkeyMap.stop})">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
          </button>
          <button class="player-btn" id="player-btn-next" title="Next File (${hotkeyMap.nextFile})">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>

        <div class="player-progress-section">
          <span class="player-time" id="player-time-current">${formatTime(audioEl?.currentTime)}</span>
          <div class="player-progress-bar" id="player-progress-bar">
            <div class="player-progress-fill" id="player-progress-fill" style="width: 0%"></div>
          </div>
          <span class="player-time" id="player-time-duration">${formatTime(audioEl?.duration)}</span>
        </div>

        <div class="player-hotkey-hints">
          <kbd>${hotkeyMap.prevFile}</kbd> Prev
          <kbd>${hotkeyMap.togglePlayPause}</kbd> Play
          <kbd>${hotkeyMap.stop}</kbd> Stop
          <kbd>${hotkeyMap.nextFile}</kbd> Next
          ${extraHints.length ? '<span style="opacity:0.3;margin:0 4px">|</span>' : ''}${extraHints.map(h => `<kbd>${h.key}</kbd> ${h.label}`).join(' ')}
        </div>
      </div>
    `;
    }

    /**
     * Bind player button events
     */
    function bindPlayerEvents() {
        document.getElementById('player-btn-prev')?.addEventListener('click', prevFile);
        document.getElementById('player-btn-play')?.addEventListener('click', togglePlayPause);
        document.getElementById('player-btn-stop')?.addEventListener('click', stop);
        document.getElementById('player-btn-next')?.addEventListener('click', nextFile);

        // Progress bar click to seek
        const progressBar = document.getElementById('player-progress-bar');
        if (progressBar) {
            progressBar.addEventListener('click', (e) => {
                if (!audioEl || !audioEl.duration) return;
                const rect = progressBar.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                audioEl.currentTime = ratio * audioEl.duration;
            });
        }
    }

    /**
     * Update player UI state
     */
    function updatePlayerUI() {
        const fileNameEl = document.getElementById('player-file-name');
        const playBtn = document.getElementById('player-btn-play');
        const counterEl = document.querySelector('.player-file-counter');

        if (fileNameEl && currentIndex >= 0) {
            fileNameEl.textContent = getFileName(currentFiles[currentIndex]);
            fileNameEl.title = currentFiles[currentIndex];
        } else if (fileNameEl) {
            fileNameEl.textContent = '—';
        }

        if (counterEl) {
            counterEl.textContent = currentFiles.length > 0
                ? `${currentIndex + 1} / ${currentFiles.length}`
                : '0 / 0';
        }

        if (playBtn) {
            playBtn.innerHTML = isPlaying
                ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'
                : '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        }

        updateProgressUI();
    }

    /**
     * Update progress bar and time display
     */
    function updateProgressUI() {
        const fill = document.getElementById('player-progress-fill');
        const currentTimeEl = document.getElementById('player-time-current');
        const durationEl = document.getElementById('player-time-duration');

        if (audioEl && fill) {
            const progress = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
            fill.style.width = `${progress}%`;
        }

        if (currentTimeEl) {
            currentTimeEl.textContent = formatTime(audioEl?.currentTime);
        }

        if (durationEl) {
            durationEl.textContent = formatTime(audioEl?.duration);
        }
    }

    /**
     * Getters
     */
    function getCurrentIndex() { return currentIndex; }
    function getCurrentFile() { return currentIndex >= 0 ? currentFiles[currentIndex] : null; }
    function getFiles() { return currentFiles; }
    function getIsPlaying() { return isPlaying; }

    /**
     * Show the player bar in the persistent bottom container
     */
    function showPlayerBar() {
        const container = document.getElementById('audio-player-container');
        if (container) {
            container.innerHTML = renderPlayerBar();
            container.classList.remove('hidden');
            bindPlayerEvents();
        }
    }

    /**
     * Hide the player bar
     */
    function hidePlayerBar() {
        const container = document.getElementById('audio-player-container');
        if (container) {
            container.innerHTML = '';
            container.classList.add('hidden');
        }
    }

    return {
        init,
        loadFiles,
        loadFile,
        goToFile,
        togglePlayPause,
        stop,
        prevFile,
        nextFile,
        onFileChange,
        renderPlayerBar,
        bindPlayerEvents,
        showPlayerBar,
        hidePlayerBar,
        getCurrentIndex,
        getCurrentFile,
        getFiles,
        getIsPlaying,
        getFileName,
        setHotkeys,
        getHotkeys,
        setExtraHints,
    };
})();
