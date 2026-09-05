const { app, BrowserWindow, ipcMain, dialog, globalShortcut, protocol, net, Menu, MenuItem, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

let mainWindow;

// Settings file path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
    return {};
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'Running Sheet Transcriber',
        icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
            spellcheck: true,
        },
        show: false,
        autoHideMenuBar: true,
    });

    Menu.setApplicationMenu(null);

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.maximize();
    });

    // Right-click context menu with spell-check suggestions
    mainWindow.webContents.on('context-menu', (event, params) => {
        const menu = new Menu();

        if (params.misspelledWord) {
            params.dictionarySuggestions.slice(0, 3).forEach(suggestion => {
                menu.append(new MenuItem({
                    label: suggestion,
                    click: () => mainWindow.webContents.replaceMisspelling(suggestion),
                }));
            });
            if (params.dictionarySuggestions.length > 0) {
                menu.append(new MenuItem({ type: 'separator' }));
            }
            menu.append(new MenuItem({
                label: 'Add to Dictionary',
                click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
            }));
            menu.append(new MenuItem({ type: 'separator' }));
        }

        if (params.editFlags.canCut)   menu.append(new MenuItem({ role: 'cut' }));
        if (params.editFlags.canCopy)  menu.append(new MenuItem({ role: 'copy' }));
        if (params.editFlags.canPaste) menu.append(new MenuItem({ role: 'paste' }));

        if (menu.items.length > 0) menu.popup();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Register protocol for serving local audio files
    protocol.handle('safe-file', (request) => {
        // URL format: safe-file:///E:/path/to/file.mp3
        let filePath = decodeURI(request.url.replace('safe-file:///', ''));
        // On Windows the path might need backslashes
        filePath = filePath.replace(/\//g, path.sep);

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.m4a': 'audio/mp4',
            '.wma': 'audio/x-ms-wma',
            '.ogg': 'audio/ogg',
            '.flac': 'audio/flac',
        };

        try {
            const data = fs.readFileSync(filePath);
            return new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                    'Content-Length': data.length.toString(),
                },
            });
        } catch (e) {
            console.error('safe-file protocol error:', e.message);
            return new Response('File not found', { status: 404 });
        }
    });

    // Set spell checker languages before window opens so dictionaries are ready
    session.defaultSession.setSpellCheckerLanguages(['en-AU', 'en-GB', 'en-US']);

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// ─── IPC Handlers ────────────────────────────────────────────

// Settings
ipcMain.handle('settings:get', () => {
    return loadSettings();
});

ipcMain.handle('settings:set', (event, settings) => {
    saveSettings(settings);
    return true;
});

// App: get current version
ipcMain.handle('app:getVersion', () => app.getVersion());

// App: set spell checker language
ipcMain.handle('app:setSpellCheckerLanguage', (event, langCode) => {
    session.defaultSession.setSpellCheckerLanguages([langCode]);
    return true;
});

// App: check GitHub for latest release
ipcMain.handle('app:checkForUpdates', async () => {
    try {
        const response = await net.fetch(
            'https://api.github.com/repos/JarlOfSunAndRain/RunningSheetTranscriber/releases/latest',
            { headers: { 'User-Agent': 'RunningSheetTranscriber-UpdateChecker' } }
        );
        if (!response.ok) return { error: `HTTP ${response.status}` };
        const data = await response.json();
        const latestVersion = (data.tag_name || '').replace(/^v/, '');
        const currentVersion = app.getVersion();
        // Compare semver: only flag an update if GitHub version is strictly newer
        const parseVer = v => v.split('.').map(Number);
        const [lMaj, lMin, lPat] = parseVer(latestVersion);
        const [cMaj, cMin, cPat] = parseVer(currentVersion);
        const hasUpdate = latestVersion && (
            lMaj > cMaj || (lMaj === cMaj && lMin > cMin) || (lMaj === cMaj && lMin === cMin && lPat > cPat)
        );
        return { currentVersion, latestVersion, hasUpdate, downloadUrl: data.html_url };
    } catch (e) {
        return { error: e.message };
    }
});

// Shell: open URL in default browser
ipcMain.handle('shell:openExternal', (event, url) => {
    shell.openExternal(url);
});

// Dialog: select storage directory
ipcMain.handle('dialog:selectDirectory', async (event, title) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: title || 'Select Directory',
        properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

// Dialog: save file
ipcMain.handle('dialog:saveFile', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    if (result.canceled) return null;
    return result.filePath;
});

// File system operations
ipcMain.handle('fs:readDir', async (event, dirPath) => {
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            path: path.join(dirPath, e.name),
        }));
    } catch (e) {
        console.error('fs:readDir error:', e);
        return [];
    }
});

ipcMain.handle('fs:readFile', async (event, filePath) => {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        return null;
    }
});

ipcMain.handle('fs:writeFile', async (event, filePath, data) => {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, data, 'utf-8');
        return true;
    } catch (e) {
        console.error('fs:writeFile error:', e);
        return false;
    }
});

ipcMain.handle('fs:exists', async (event, filePath) => {
    return fs.existsSync(filePath);
});

ipcMain.handle('fs:mkdir', async (event, dirPath) => {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return true;
    } catch (e) {
        console.error('fs:mkdir error:', e);
        return false;
    }
});

ipcMain.handle('fs:rmdir', async (event, dirPath) => {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
        return true;
    } catch (e) {
        console.error('fs:rmdir error:', e);
        return false;
    }
});

ipcMain.handle('fs:stat', async (event, filePath) => {
    try {
        const stat = fs.statSync(filePath);
        return {
            size: stat.size,
            isDirectory: stat.isDirectory(),
            modified: stat.mtimeMs,
            created: stat.birthtimeMs,
        };
    } catch (e) {
        return null;
    }
});

// Scan folder for audio files
ipcMain.handle('audio:scanFolder', async (event, folderPath) => {
    const supportedExtensions = ['.wav', '.mp3', '.wma', '.m4a'];
    try {
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        const audioFiles = entries
            .filter(e => e.isFile() && supportedExtensions.includes(path.extname(e.name).toLowerCase()))
            .map(e => ({
                name: e.name,
                path: path.join(folderPath, e.name),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        return audioFiles;
    } catch (e) {
        console.error('audio:scanFolder error:', e);
        return [];
    }
});

// Get app userData path
ipcMain.handle('app:getUserDataPath', () => {
    return app.getPath('userData');
});

// Convert audio file to playable format if needed (e.g. WMA → WAV)
const unsupportedFormats = ['.wma'];
const convertedCache = {}; // cache: originalPath → convertedPath

// Build a valid file:// URL from an absolute path on any platform.
// Windows paths (e.g. E:/x.mp3) lack a leading slash; POSIX paths (e.g. /home/x.mp3) already have one —
// always ensure exactly one leading slash before the 'file://' prefix to avoid a malformed 'file:////' URL on Linux/macOS.
function toFileUrl(filePath) {
    let normalizedPath = filePath.replace(/\\/g, '/');
    if (!normalizedPath.startsWith('/')) normalizedPath = '/' + normalizedPath;
    return 'file://' + encodeURI(normalizedPath);
}

ipcMain.handle('audio:getPlayableUrl', async (event, filePath) => {
    const ext = path.extname(filePath).toLowerCase();

    // If already a supported format, return file:// URL directly
    if (!unsupportedFormats.includes(ext)) {
        return toFileUrl(filePath);
    }

    // Check cache
    if (convertedCache[filePath] && fs.existsSync(convertedCache[filePath])) {
        return toFileUrl(convertedCache[filePath]);
    }

    // Convert to WAV using ffmpeg
    const tempDir = path.join(app.getPath('temp'), 'rst-audio-cache');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const baseName = path.basename(filePath, ext) + '.wav';
    const outPath = path.join(tempDir, baseName);

    return new Promise((resolve, reject) => {
        execFile(ffmpegPath, [
            '-y',           // overwrite
            '-i', filePath, // input
            '-acodec', 'pcm_s16le', // WAV codec
            '-ar', '44100', // sample rate
            '-ac', '2',     // stereo
            outPath,
        ], (error) => {
            if (error) {
                console.error('ffmpeg conversion error:', error.message);
                // Fallback: return original file URL anyway
                resolve(toFileUrl(filePath));
            } else {
                console.log('Converted:', filePath, '->', outPath);
                convertedCache[filePath] = outPath;
                resolve(toFileUrl(outPath));
            }
        });
    });
});

// ─── Export Handlers ──────────────────────────────────────────

// Export to Excel
ipcMain.handle('export:excel', async (event, { filePath, metadata, entries }) => {
    const ExcelJS = require('exceljs');

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Referee Assessment Form');

        sheet.columns = [
            { width: 4 }, { width: 4 }, { width: 6 },
            { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 },
            { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 }, { width: 6 },
            { width: 6 }, { width: 6 },
        ];

        let row = 1;

        // Match title
        const matchTitle = (metadata.homeTeam && metadata.awayTeam)
            ? `${metadata.homeTeam}  vs  ${metadata.awayTeam}`
            : (metadata.homeTeam || metadata.awayTeam || '');

        if (matchTitle) {
            sheet.mergeCells(`A${row}:O${row}`);
            const cell = sheet.getCell(`A${row}`);
            cell.value = matchTitle;
            cell.font = { name: 'Calibri', size: 14, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            sheet.getRow(row).height = 24;
            row++;
        }

        // Date & Venue
        const dateParts = [];
        if (metadata.matchDate) {
            const d = new Date(metadata.matchDate + 'T00:00:00');
            dateParts.push(d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }));
        }
        if (metadata.venue) dateParts.push(metadata.venue);
        if (dateParts.length > 0) {
            sheet.mergeCells(`A${row}:O${row}`);
            const cell = sheet.getCell(`A${row}`);
            cell.value = dateParts.join('    |    ');
            cell.font = { name: 'Calibri', size: 10 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            sheet.getRow(row).height = 18;
            row++;
        }

        // Officials
        const officials = [];
        if (metadata.referee) officials.push(`Ref: ${metadata.referee}`);
        if (metadata.ar1) officials.push(`AR1: ${metadata.ar1}`);
        if (metadata.ar2) officials.push(`AR2: ${metadata.ar2}`);
        if (metadata.fourthOfficial) officials.push(`4th: ${metadata.fourthOfficial}`);
        if (metadata.var) officials.push(`VAR: ${metadata.var}`);
        if (metadata.avar) officials.push(`AVAR: ${metadata.avar}`);
        if (officials.length > 0) {
            sheet.mergeCells(`A${row}:O${row}`);
            const cell = sheet.getCell(`A${row}`);
            cell.value = officials.join('    |    ');
            cell.font = { name: 'Calibri', size: 9, color: { argb: '555555' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            sheet.getRow(row).height = 16;
            row++;
        }

        row++;

        // Table header
        sheet.mergeCells(`A${row}:C${row}`);
        sheet.mergeCells(`D${row}:O${row}`);
        sheet.getCell(`A${row}`).value = 'Time';
        sheet.getCell(`A${row}`).font = { name: 'Calibri', size: 12, bold: true };
        sheet.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getCell(`D${row}`).value = 'Incident / Comment';
        sheet.getCell(`D${row}`).font = { name: 'Calibri', size: 12, bold: true };
        sheet.getCell(`D${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
        for (let c = 1; c <= 15; c++) {
            const cell = sheet.getCell(row, c);
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C0C0C0' } };
            cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        }
        sheet.getRow(row).height = 24;
        row++;

        // Data rows
        entries.forEach(entry => {
            // Period break row
            if (entry.type === 'break') {
                sheet.mergeCells(`A${row}:O${row}`);
                const cell = sheet.getCell(`A${row}`);
                cell.value = entry.breakLabel || 'BREAK';
                cell.font = { name: 'Calibri', size: 12, bold: true };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                for (let c = 1; c <= 15; c++) {
                    const borderCell = sheet.getCell(row, c);
                    borderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D9D9D9' } };
                    borderCell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
                }
                sheet.getRow(row).height = 22;
                row++;
                return;
            }

            sheet.mergeCells(`A${row}:C${row}`);
            sheet.mergeCells(`D${row}:O${row}`);
            sheet.getCell(`A${row}`).value = entry.time || '';
            sheet.getCell(`A${row}`).font = { name: 'Calibri', size: 11 };
            sheet.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
            // Comment as plain text (text highlights only render in PDF)
            const commentCell = sheet.getCell(`D${row}`);
            commentCell.value = entry.comment || '';
            commentCell.font = { name: 'Calibri', size: 11 };
            commentCell.alignment = { vertical: 'top', wrapText: true };

            let fillColor = null;
            if (entry.highlight === 'incident') fillColor = '839F4E';
            else if (entry.highlight === 'key') fillColor = '5E96DE';

            for (let c = 1; c <= 15; c++) {
                const cell = sheet.getCell(row, c);
                cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
                if (fillColor) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
                }
            }

            const lines = Math.max(1, Math.ceil((entry.comment || '').length / 80));
            sheet.getRow(row).height = Math.max(18, lines * 16);
            row++;
        });

        await workbook.xlsx.writeFile(filePath);
        return { success: true, filePath };
    } catch (e) {
        console.error('Excel export error:', e);
        return { success: false, error: e.message };
    }
});

// Export to PDF
ipcMain.handle('export:pdf', async (event, { filePath, metadata, entries }) => {
    const PDFDocument = require('pdfkit');

    try {
        const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 40, right: 40 } });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const timeColWidth = 60;
        const commentColWidth = pageWidth - timeColWidth;

        // Compact header
        const matchTitle = (metadata.homeTeam && metadata.awayTeam)
            ? `${metadata.homeTeam}  vs  ${metadata.awayTeam}`
            : (metadata.homeTeam || metadata.awayTeam || 'Running Sheet');
        doc.font('Helvetica-Bold').fontSize(14).text(matchTitle, { align: 'center' });

        const dateParts = [];
        if (metadata.matchDate) {
            const d = new Date(metadata.matchDate + 'T00:00:00');
            dateParts.push(d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }));
        }
        if (metadata.competition) dateParts.push(metadata.competition);
        if (metadata.venue) dateParts.push(metadata.venue);
        if (dateParts.length > 0) {
            doc.font('Helvetica').fontSize(8).text(dateParts.join('   |   '), { align: 'center' });
        }

        const officials = [];
        if (metadata.referee) officials.push(`Ref: ${metadata.referee}`);
        if (metadata.ar1) officials.push(`AR1: ${metadata.ar1}`);
        if (metadata.ar2) officials.push(`AR2: ${metadata.ar2}`);
        if (metadata.fourthOfficial) officials.push(`4th: ${metadata.fourthOfficial}`);
        if (metadata.var) officials.push(`VAR: ${metadata.var}`);
        if (metadata.avar) officials.push(`AVAR: ${metadata.avar}`);
        if (metadata.reserveAr) officials.push(`RAR: ${metadata.reserveAr}`);
        if (officials.length > 0) {
            doc.font('Helvetica').fontSize(8).fillColor('#555555');
            doc.text(officials.join('   |   '), { align: 'center' });
            doc.fillColor('#000000');
        }

        doc.moveDown(0.8);

        // Table header
        const tableLeft = doc.page.margins.left;
        let y = doc.y;
        doc.rect(tableLeft, y, pageWidth, 22).fill('#C0C0C0');
        doc.fillColor('#000000');
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Time', tableLeft, y + 5, { width: timeColWidth, align: 'center' });
        doc.text('Incident / Comment', tableLeft + timeColWidth, y + 5, { width: commentColWidth, align: 'center' });
        doc.rect(tableLeft, y, timeColWidth, 22).stroke('#000000');
        doc.rect(tableLeft + timeColWidth, y, commentColWidth, 22).stroke('#000000');
        y += 22;

        // Data rows
        doc.font('Helvetica').fontSize(10);
        entries.forEach(entry => {
            // Period break row
            if (entry.type === 'break') {
                const breakLabel = entry.breakLabel || 'BREAK';
                const breakHeight = 22;
                if (y + breakHeight > doc.page.height - doc.page.margins.bottom) {
                    doc.addPage();
                    y = doc.page.margins.top;
                }
                doc.rect(tableLeft, y, pageWidth, breakHeight).fill('#D9D9D9');
                doc.fillColor('#000000');
                doc.font('Helvetica-Bold').fontSize(10);
                doc.text(breakLabel, tableLeft, y + 5, { width: pageWidth, align: 'center' });
                doc.rect(tableLeft, y, pageWidth, breakHeight).stroke('#666666');
                doc.font('Helvetica').fontSize(10);
                y += breakHeight;
                return;
            }

            const comment = entry.comment || '';
            const time = entry.time || '';
            const commentHeight = doc.heightOfString(comment, { width: commentColWidth - 10 });
            const rowHeight = Math.max(14, commentHeight + 4);

            if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
                y = doc.page.margins.top;
            }

            if (entry.highlight === 'incident') {
                doc.rect(tableLeft, y, pageWidth, rowHeight).fill('#839F4E');
                doc.fillColor('#000000');
            } else if (entry.highlight === 'key') {
                doc.rect(tableLeft, y, pageWidth, rowHeight).fill('#5E96DE');
                doc.fillColor('#000000');
            }

            doc.text(time, tableLeft + 2, y + 4, { width: timeColWidth - 4, align: 'center' });

            // Render comment with text highlights (marker effect)
            const commentX = tableLeft + timeColWidth + 5;
            const commentW = commentColWidth - 10;
            if (entry.textHighlights && entry.textHighlights.length > 0) {
                // Parse segments
                let remaining = comment;
                const segments = [];
                for (const hl of entry.textHighlights) {
                    const idx = remaining.indexOf(hl.text);
                    if (idx === -1) continue;
                    if (idx > 0) {
                        segments.push({ text: remaining.substring(0, idx), isHighlight: false });
                    }
                    const c = (hl.color || '').toLowerCase();
                    let rectColor = '#E06666';
                    if (c.includes('255, 255, 0') || c.includes('ffff00') || c.includes('yellow')) {
                        rectColor = '#FFFF00';
                    }
                    segments.push({ text: hl.text, isHighlight: true, color: rectColor });
                    remaining = remaining.substring(idx + hl.text.length);
                }
                if (remaining) {
                    segments.push({ text: remaining, isHighlight: false });
                }

                // Two-pass approach:
                // Pass 1: Render full text invisibly to get PDFKit's actual layout
                doc.font('Helvetica').fontSize(10);
                const textStartY = y + 4;

                // Pass 1: measure where each character lands by rendering segments
                // Use PDFKit's continued text to render inline segments
                // First, draw highlight rects by finding positions of highlighted text
                // within the full rendered comment string

                // Build array of {startIdx, endIdx, color} for highlights in the full string
                const highlightRanges = [];
                let charOffset = 0;
                for (const seg of segments) {
                    if (seg.isHighlight) {
                        highlightRanges.push({
                            start: charOffset,
                            end: charOffset + seg.text.length,
                            color: seg.color,
                            text: seg.text
                        });
                    }
                    charOffset += seg.text.length;
                }

                // Use PDFKit's widthOfString and line breaking to find positions
                // Split the full comment into lines as PDFKit would wrap them
                const words = comment.split(' ');
                const lines = [];
                let currentLine = '';
                for (const word of words) {
                    const testLine = currentLine ? currentLine + ' ' + word : word;
                    if (doc.widthOfString(testLine) > commentW && currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        currentLine = testLine;
                    }
                }
                if (currentLine) lines.push(currentLine);

                // Map each line to its character range in the full string
                const lineHeight = doc.currentLineHeight(1.2);
                let lineCharOffset = 0;
                for (let li = 0; li < lines.length; li++) {
                    const line = lines[li];
                    const lineStartChar = lineCharOffset;
                    const lineEndChar = lineCharOffset + line.length;
                    const lineY = textStartY + li * lineHeight;

                    // Check each highlight range against this line
                    for (const hr of highlightRanges) {
                        const overlapStart = Math.max(hr.start, lineStartChar);
                        const overlapEnd = Math.min(hr.end, lineEndChar);
                        if (overlapStart < overlapEnd) {
                            // There's overlap — calculate X position
                            const beforeText = line.substring(0, overlapStart - lineStartChar);
                            const highlightText = line.substring(overlapStart - lineStartChar, overlapEnd - lineStartChar);
                            const xStart = commentX + doc.widthOfString(beforeText);
                            const hlWidth = doc.widthOfString(highlightText);
                            const padX = 2;
                            const padY = 1;
                            doc.save();
                            doc.rect(xStart - padX, lineY - padY, hlWidth + padX * 2, lineHeight * 0.88).fill(hr.color);
                            doc.restore();
                        }
                    }
                    // Account for the space between lines (the space that was used to split)
                    lineCharOffset += line.length + 1; // +1 for the space
                }

                // Pass 2: render the actual text on top
                doc.fillColor('#000000');
                doc.text(comment, commentX, textStartY, { width: commentW });
            } else {
                doc.text(comment, commentX, y + 4, { width: commentW });
            }
            doc.rect(tableLeft, y, timeColWidth, rowHeight).stroke('#666666');
            doc.rect(tableLeft + timeColWidth, y, commentColWidth, rowHeight).stroke('#666666');
            y += rowHeight;
        });

        doc.end();
        await new Promise((resolve, reject) => {
            stream.on('finish', resolve);
            stream.on('error', reject);
        });

        return { success: true, filePath };
    } catch (e) {
        console.error('PDF export error:', e);
        return { success: false, error: e.message };
    }
});

