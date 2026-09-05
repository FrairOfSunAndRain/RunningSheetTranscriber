/**
 * Storage Service
 * Handles all data persistence for running sheets using JSON files.
 * Each running sheet is stored as a subfolder within the user-chosen root directory.
 */
const Storage = (() => {
    let rootDir = null;

    /**
     * Initialize storage with the root directory from settings
     */
    async function init() {
        const settings = await window.api.settings.get();
        rootDir = settings.storageDirectory || null;
        return rootDir;
    }

    /**
     * Get or set the root storage directory
     */
    function getRootDir() {
        return rootDir;
    }

    async function setRootDir(dir) {
        rootDir = dir;
        const settings = await window.api.settings.get();
        settings.storageDirectory = dir;
        await window.api.settings.set(settings);
    }

    /**
     * Generate a simple unique ID
     */
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    }

    /**
     * Get the path to a running sheet's directory
     */
    function getSheetDir(sheetId) {
        return `${rootDir}/${sheetId}`;
    }

    /**
     * Create a new running sheet
     */
    async function createRunningSheet(metadata) {
        if (!rootDir) throw new Error('Storage directory not set');

        const id = generateId();
        const sheetDir = getSheetDir(id);

        await window.api.fs.mkdir(sheetDir);

        const fullMetadata = {
            id,
            matchDate: metadata.matchDate || '',
            homeTeam: metadata.homeTeam || '',
            awayTeam: metadata.awayTeam || '',
            venue: metadata.venue || '',
            competition: metadata.competition || '',
            referee: metadata.referee || '',
            ar1: metadata.ar1 || '',
            ar2: metadata.ar2 || '',
            fourthOfficial: metadata.fourthOfficial || '',
            var: metadata.var || '',
            avar: metadata.avar || '',
            reserveAr: metadata.reserveAr || '',
            createdAt: new Date().toISOString(),
        };

        await window.api.fs.writeFile(`${sheetDir}/metadata.json`, JSON.stringify(fullMetadata, null, 2));
        await window.api.fs.writeFile(`${sheetDir}/audio_references.json`, JSON.stringify([]));
        await window.api.fs.writeFile(`${sheetDir}/entries.json`, JSON.stringify([]));
        await window.api.fs.writeFile(`${sheetDir}/tags.json`, JSON.stringify([]));

        return fullMetadata;
    }

    /**
     * List all running sheets
     */
    async function listRunningSheets() {
        if (!rootDir) return [];

        const exists = await window.api.fs.exists(rootDir);
        if (!exists) return [];

        const entries = await window.api.fs.readDir(rootDir);
        const sheets = [];

        for (const entry of entries) {
            if (!entry.isDirectory) continue;

            const metaPath = `${entry.path}/metadata.json`;
            const metaExists = await window.api.fs.exists(metaPath);
            if (!metaExists) continue;

            try {
                const metaRaw = await window.api.fs.readFile(metaPath);
                const metadata = JSON.parse(metaRaw);

                // Count audio files
                const audioPath = `${entry.path}/audio_references.json`;
                let audioCount = 0;
                const audioExists = await window.api.fs.exists(audioPath);
                if (audioExists) {
                    const audioRaw = await window.api.fs.readFile(audioPath);
                    const audioRefs = JSON.parse(audioRaw);
                    audioCount = audioRefs.length;
                }

                // Count entries
                const entriesPath = `${entry.path}/entries.json`;
                let entriesCount = 0;
                const entriesExists = await window.api.fs.exists(entriesPath);
                if (entriesExists) {
                    const entriesRaw = await window.api.fs.readFile(entriesPath);
                    const entriesData = JSON.parse(entriesRaw);
                    entriesCount = entriesData.length;
                }

                sheets.push({
                    ...metadata,
                    audioCount,
                    entriesCount,
                    dirPath: entry.path,
                });
            } catch (e) {
                console.error('Error reading sheet:', entry.path, e);
            }
        }

        // Sort by matchDate descending (newest first), fallback to createdAt
        sheets.sort((a, b) => {
            const dateA = a.matchDate || a.createdAt || '';
            const dateB = b.matchDate || b.createdAt || '';
            return dateB.localeCompare(dateA);
        });
        return sheets;
    }

    /**
     * Open a running sheet — returns full data
     */
    async function openRunningSheet(sheetId) {
        const sheetDir = getSheetDir(sheetId);

        const metaRaw = await window.api.fs.readFile(`${sheetDir}/metadata.json`);
        const audioRaw = await window.api.fs.readFile(`${sheetDir}/audio_references.json`);
        const entriesRaw = await window.api.fs.readFile(`${sheetDir}/entries.json`);
        const tagsRaw = await window.api.fs.readFile(`${sheetDir}/tags.json`);

        return {
            metadata: JSON.parse(metaRaw),
            audioFiles: JSON.parse(audioRaw),
            entries: JSON.parse(entriesRaw),
            tags: tagsRaw ? JSON.parse(tagsRaw) : [],
        };
    }

    /**
     * Delete a running sheet
     */
    async function deleteRunningSheet(sheetId) {
        const sheetDir = getSheetDir(sheetId);
        return await window.api.fs.rmdir(sheetDir);
    }

    /**
     * Save metadata
     */
    async function saveMetadata(sheetId, metadata) {
        const sheetDir = getSheetDir(sheetId);
        await window.api.fs.writeFile(`${sheetDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    }

    /**
     * Save audio references
     */
    async function saveAudioReferences(sheetId, audioFiles) {
        const sheetDir = getSheetDir(sheetId);
        await window.api.fs.writeFile(`${sheetDir}/audio_references.json`, JSON.stringify(audioFiles, null, 2));
    }

    /**
     * Save entries
     */
    async function saveEntries(sheetId, entries) {
        const sheetDir = getSheetDir(sheetId);
        await window.api.fs.writeFile(`${sheetDir}/entries.json`, JSON.stringify(entries, null, 2));
    }

    /**
     * Save tags
     */
    async function saveTags(sheetId, tags) {
        const sheetDir = getSheetDir(sheetId);
        await window.api.fs.writeFile(`${sheetDir}/tags.json`, JSON.stringify(tags, null, 2));
    }

    /**
     * Update a single entry's field (with autosave)
     */
    async function updateEntry(sheetId, entryId, field, value) {
        const sheetDir = getSheetDir(sheetId);
        const entriesRaw = await window.api.fs.readFile(`${sheetDir}/entries.json`);
        const entries = JSON.parse(entriesRaw);

        const entry = entries.find(e => e.id === entryId);
        if (entry) {
            entry[field] = value;
            await saveEntries(sheetId, entries);
        }

        return entries;
    }

    /**
     * Mark a running sheet as complete
     */
    async function markComplete(sheetId) {
        const sheetDir = getSheetDir(sheetId);
        const metaRaw = await window.api.fs.readFile(`${sheetDir}/metadata.json`);
        const metadata = JSON.parse(metaRaw);
        metadata.completedAt = new Date().toISOString();
        await window.api.fs.writeFile(`${sheetDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    }

    /**
     * Remove the complete status from a running sheet
     */
    async function removeComplete(sheetId) {
        const sheetDir = getSheetDir(sheetId);
        const metaRaw = await window.api.fs.readFile(`${sheetDir}/metadata.json`);
        const metadata = JSON.parse(metaRaw);
        delete metadata.completedAt;
        await window.api.fs.writeFile(`${sheetDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    }

    /**
     * Get the auto-delete retention period in days (default 30)
     */
    async function getRetentionDays() {
        const settings = await window.api.settings.get();
        return settings.retentionDays ?? 30;
    }

    /**
     * Set the auto-delete retention period in days
     */
    async function setRetentionDays(days) {
        const settings = await window.api.settings.get();
        settings.retentionDays = days;
        await window.api.settings.set(settings);
    }

    /**
     * Delete any completed sheets whose retention period has expired
     */
    async function purgeExpiredSheets() {
        const settings = await window.api.settings.get();
        const retentionDays = settings.retentionDays ?? 30;
        const now = Date.now();
        const sheets = await listRunningSheets();
        for (const sheet of sheets) {
            if (!sheet.completedAt) continue;
            const completedMs = new Date(sheet.completedAt).getTime();
            const ageMs = now - completedMs;
            const ageDays = ageMs / (1000 * 60 * 60 * 24);
            if (ageDays >= retentionDays) {
                await deleteRunningSheet(sheet.id);
            }
        }
    }

    return {
        init,
        getRootDir,
        setRootDir,
        generateId,
        createRunningSheet,
        listRunningSheets,
        openRunningSheet,
        deleteRunningSheet,
        markComplete,
        removeComplete,
        getRetentionDays,
        setRetentionDays,
        purgeExpiredSheets,
        saveMetadata,
        saveAudioReferences,
        saveEntries,
        saveTags,
        updateEntry,
    };
})();
