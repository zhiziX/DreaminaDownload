class BackgroundService {
    constructor() {
        this.downloadDiagnostics = [];
        this.maxDiagnostics = 30;
        chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
            this.handleMessage(request, sendResponse);
            return true;
        });
    }

    async handleMessage(request, sendResponse) {
        try {
            if (request.action === 'downloadFile') {
                const mediaType = request.mediaType || this.detectMediaType(request.url, request.filename);
                const result = mediaType === 'image'
                    ? await this.downloadImage(request.url, request.filename, {
                        preferBlob: request.preferBlob === true,
                        pageUrl: request.pageUrl || '',
                        source: request.source || '',
                        extraImageCandidates: request.extraImageCandidates
                    })
                    : await this.downloadDirect(
                        request.url,
                        this.buildFilename(request.filename, request.url, { mediaType })
                    );

                sendResponse({ success: true, ...result });
                return;
            }

            if (request.action === 'downloadWithTab') {
                this.downloadWithTab(request, sendResponse);
                return;
            }

            if (request.action === 'getDownloadDiagnostics') {
                const limit = Math.max(1, Math.min(100, Number(request.limit || 20)));
                sendResponse({
                    success: true,
                    diagnostics: this.downloadDiagnostics.slice(0, limit)
                });
                return;
            }

            if (request.action === 'clearDownloadDiagnostics') {
                this.downloadDiagnostics = [];
                sendResponse({ success: true });
                return;
            }

            sendResponse({ success: false, error: 'Unknown action' });
        } catch (error) {
            sendResponse({
                success: false,
                error: error?.message || '处理失败',
                details: error?.details || null
            });
        }
    }

    async downloadWithTab(request, sendResponse) {
        const detailUrl = request.detailUrl || request.pageUrl;
        if (!detailUrl) {
            sendResponse({ success: false, error: '缺少详情页URL' });
            return;
        }

        let tabId = null;
        let timeoutId = null;
        let messageListener = null;

        try {
            const tab = await chrome.tabs.create({
                url: detailUrl,
                active: false
            });
            tabId = tab.id;

            const result = await new Promise((resolve, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error('解析超时（30秒）'));
                }, 30000);

                messageListener = async (message, sender) => {
                    if (sender.tab?.id !== tabId) return;
                    if (message.action !== 'tabParseComplete') return;

                    clearTimeout(timeoutId);
                    chrome.runtime.onMessage.removeListener(messageListener);

                    if (!message.success || !message.mediaItems?.length) {
                        reject(new Error(message.error || '未解析到媒体'));
                        return;
                    }

                    const item = message.mediaItems[0];
                    try {
                        const mediaType = item.type || this.detectMediaType(item.url, item.filename);
                        const downloadResult = mediaType === 'video'
                            ? await this.downloadDirect(
                                item.url,
                                this.buildFilename(item.filename, item.url, { mediaType: 'video' })
                            )
                            : await this.downloadImage(item.url, item.filename, {
                                preferBlob: false,
                                pageUrl: detailUrl,
                                source: item.source || 'tab-parse',
                                extraImageCandidates: item.extraImageCandidates || []
                            });
                        resolve({ success: true, ...downloadResult, source: item.source });
                    } catch (error) {
                        reject(error);
                    }
                };

                chrome.runtime.onMessage.addListener(messageListener);


                const trySend = (attempt) => {
                    chrome.tabs.sendMessage(tabId, { action: 'startTabParse' }).catch(() => {
                        if (attempt < 5) {
                            setTimeout(() => trySend(attempt + 1), 2000);
                        }
                    });
                };
                trySend(0);
            });

            sendResponse(result);
        } catch (error) {
            sendResponse({
                success: false,
                error: error?.message || '弹tab解析失败'
            });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (messageListener) chrome.runtime.onMessage.removeListener(messageListener);
            if (tabId) {
                chrome.tabs.remove(tabId).catch(() => {});
            }
        }
    }

    async downloadImage(url, filename, { preferBlob = false, pageUrl = '', source = '', extraImageCandidates = [] } = {}) {
        const trace = {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            startedAt: Date.now(),
            selectedUrl: String(url || ''),
            selectedSource: String(source || ''),
            pageUrl: String(pageUrl || ''),
            preferBlobRequested: Boolean(preferBlob),
            candidates: [],
            directFallbackAttempts: []
        };
        const candidates = this.buildImageCandidateEntries(url, source, extraImageCandidates);

        if (!preferBlob) {
            for (const candidate of candidates) {
                try {
                    const finalFilename = this.buildFilename(filename, candidate.url, { mediaType: 'image' });
                    const result = await this.downloadDirect(candidate.url, finalFilename);
                    trace.finishedAt = Date.now();
                    trace.status = 'success';
                    trace.winner = {
                        source: candidate.source,
                        variant: 'direct',
                        url: candidate.url,
                        channel: 'downloads.download'
                    };
                    this.recordDownloadTrace(trace);
                    return { ...result, traceId: trace.id, resolvedUrl: candidate.url, source: candidate.source };
                } catch (error) {
                    continue;
                }
            }
            trace.finishedAt = Date.now();
            trace.status = 'failed';
            this.recordDownloadTrace(trace);
            throw this.createError('所有候选都下载失败', { code: 'all-candidates-failed' });
        }

        let lastError = null;
        const directFallbackQueue = [];
        const directFallbackSeen = new Set();

        for (const candidate of candidates) {
            const candidateTrace = {
                source: candidate.source,
                inputUrl: candidate.url,
                origin: candidate.origin,
                variants: []
            };
            trace.candidates.push(candidateTrace);

            const variants = this.buildImageUrlVariants(candidate.url);
            for (const variant of variants) {
                const variantTrace = {
                    variant: variant.variant,
                    url: variant.url,
                    attempts: []
                };
                candidateTrace.variants.push(variantTrace);

                try {
                    const { blob, contentType, fetchAttempts } = await this.fetchBlob(variant.url, {
                        pageUrl,
                        expectedMediaType: 'image'
                    });
                    if (Array.isArray(fetchAttempts) && fetchAttempts.length) {
                        variantTrace.attempts.push(...fetchAttempts);
                    }
                    const { width: imageWidth, height: imageHeight } = await this.detectImageDimensions(blob);
                    const finalFilename = this.applyImageSizeToFilename(
                        this.buildFilename(filename, variant.url, { mediaType: 'image', contentType }),
                        imageWidth,
                        imageHeight
                    );
                    const blobResult = await this.downloadBlob(
                        blob,
                        finalFilename
                    );
                    variantTrace.attempts.push({
                        channel: 'downloadBlob',
                        ok: true,
                        downloadId: blobResult.downloadId,
                        imageWidth: imageWidth || undefined,
                        imageHeight: imageHeight || undefined
                    });
                    trace.finishedAt = Date.now();
                    trace.status = 'success';
                    trace.winner = {
                        source: candidate.source,
                        variant: variant.variant,
                        url: variant.url,
                        channel: 'fetch+blob',
                        imageWidth: imageWidth || 0,
                        imageHeight: imageHeight || 0
                    };
                    this.recordDownloadTrace(trace);
                    return {
                        ...blobResult,
                        traceId: trace.id,
                        resolvedUrl: variant.url,
                        source: candidate.source,
                        imageWidth: imageWidth || 0,
                        imageHeight: imageHeight || 0
                    };
                } catch (error) {
                    lastError = error;
                    if (Array.isArray(error?.details?.fetchAttempts) && error.details.fetchAttempts.length) {
                        variantTrace.attempts.push(...error.details.fetchAttempts);
                    }
                    variantTrace.attempts.push({
                        channel: 'fetch+blob',
                        ok: false,
                        ...this.formatErrorDetails(error)
                    });

                    if (this.shouldQueueDirectFallback(error, variant.url, candidate.source)) {
                        const directKey = this.normalizeCandidateKey(variant.url);
                        if (directKey && !directFallbackSeen.has(directKey) && directFallbackQueue.length < 4) {
                            directFallbackSeen.add(directKey);
                            directFallbackQueue.push({
                                source: candidate.source,
                                variant: variant.variant,
                                url: variant.url
                            });
                        }
                    }
                }
            }
        }

        for (const fallback of directFallbackQueue) {
            try {
                const directResult = await this.downloadDirect(
                    fallback.url,
                    this.buildFilename(filename, fallback.url, { mediaType: 'image' })
                );
                trace.directFallbackAttempts.push({
                    ...fallback,
                    channel: 'downloads.download-fallback',
                    ok: true,
                    downloadId: directResult.downloadId
                });
                trace.finishedAt = Date.now();
                trace.status = 'success';
                trace.winner = {
                    source: fallback.source,
                    variant: fallback.variant,
                    url: fallback.url,
                    channel: 'downloads.download-fallback'
                };
                this.recordDownloadTrace(trace);
                return {
                    ...directResult,
                    traceId: trace.id,
                    resolvedUrl: fallback.url,
                    source: fallback.source
                };
            } catch (error) {
                lastError = error;
                trace.directFallbackAttempts.push({
                    ...fallback,
                    channel: 'downloads.download-fallback',
                    ok: false,
                    ...this.formatErrorDetails(error)
                });
            }
        }

        trace.finishedAt = Date.now();
        trace.status = 'failed';
        trace.error = this.formatErrorDetails(lastError);
        this.recordDownloadTrace(trace);

        const summary = this.summarizeFailureTrace(trace);
        const failure = this.createError(`图片下载失败：${summary}`, {
            code: 'image-download-failed',
            traceId: trace.id,
            summary,
            winner: null
        });
        if (lastError?.details && typeof lastError.details === 'object') {
            failure.details.lastError = lastError.details;
        }
        throw failure;
    }

    async downloadDirect(url, filename) {
        const downloadId = await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url,
                filename,
                conflictAction: 'uniquify',
                saveAs: false
            }, (id) => {
                if (chrome.runtime.lastError || typeof id !== 'number') {
                    const message = chrome.runtime.lastError?.message || '下载失败';
                    reject(this.createError(message, {
                        code: this.classifyErrorCode(message),
                        channel: 'downloads.download',
                        url
                    }));
                    return;
                }
                resolve(id);
            });
        });

        return { method: 'downloads', downloadId };
    }

    async fetchBlob(url, { pageUrl = '', expectedMediaType = '' } = {}) {
        let lastError = null;
        const referrer = this.getReferrerForUrl(url, pageUrl);
        const fetchAttempts = [];

        for (const credentials of ['omit', 'include']) {
            try {
                const headers = referrer ? { referer: referrer } : undefined;
                const response = await fetch(url, { credentials, mode: 'cors', headers });
                if (!response.ok) {
                    const status = Number(response.status || 0);
                    throw this.createError(`资源请求异常: ${status}`, {
                        code: `http-${status || 'error'}`,
                        channel: 'fetch',
                        credentials,
                        url,
                        status
                    });
                }

                const blob = await response.blob();
                if (!blob || blob.size === 0) {
                    throw this.createError('资源为空', {
                        code: 'empty-blob',
                        channel: 'fetch',
                        credentials,
                        url
                    });
                }

                const contentType = (blob.type || response.headers.get('content-type') || 'application/octet-stream').toLowerCase();
                if (expectedMediaType === 'image') {
                    const isImageType = contentType.startsWith('image/');
                    const isImageSignature = await this.isImageBlobSignature(blob);
                    if (!isImageType && !isImageSignature) {
                        throw this.createError(`资源类型异常: ${contentType || 'unknown'}`, {
                            code: 'unexpected-content-type',
                            channel: 'fetch',
                            credentials,
                            url,
                            contentType
                        });
                    }
                }

                return {
                    blob,
                    contentType,
                    fetchAttempts: [
                        ...fetchAttempts,
                        {
                            channel: 'fetch',
                            credentials,
                            ok: true,
                            status: Number(response.status || 200),
                            url
                        }
                    ]
                };
            } catch (error) {
                const details = this.formatErrorDetails(error, {
                    channel: 'fetch',
                    credentials,
                    url
                });
                fetchAttempts.push({ channel: 'fetch', credentials, ok: false, ...details });
                lastError = error;
            }
        }

        const failure = this.createError(lastError?.message || '资源获取失败', {
            ...(lastError?.details || {}),
            channel: 'fetch',
            url,
            fetchAttempts
        });
        throw failure;
    }

    async isImageBlobSignature(blob) {
        try {
            const head = await blob.slice(0, 16).arrayBuffer();
            const bytes = new Uint8Array(head);
            if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
            if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return true;
            if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;
            if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
            if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) return true;
        } catch {
        }
        return false;
    }

    async detectImageDimensions(blob) {
        try {
            const head = await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer();
            const bytes = new Uint8Array(head);
            return this.detectImageDimensionsFromBytes(bytes);
        } catch {
            return { width: 0, height: 0 };
        }
    }

    detectImageDimensionsFromBytes(bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length < 10) return { width: 0, height: 0 };

        if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
            const width = this.readUint32BE(bytes, 16);
            const height = this.readUint32BE(bytes, 20);
            return { width, height };
        }

        if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
            const width = this.readUint16LE(bytes, 6);
            const height = this.readUint16LE(bytes, 8);
            return { width, height };
        }

        if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
            const webp = this.detectWebpDimensions(bytes);
            if (webp.width && webp.height) return webp;
        }

        if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
            const jpeg = this.detectJpegDimensions(bytes);
            if (jpeg.width && jpeg.height) return jpeg;
        }

        return { width: 0, height: 0 };
    }

    detectWebpDimensions(bytes) {
        const view = bytes;
        const chunk = String.fromCharCode(view[12] || 0, view[13] || 0, view[14] || 0, view[15] || 0);
        if (chunk === 'VP8X' && view.length >= 30) {
            const width = 1 + (view[24] | (view[25] << 8) | (view[26] << 16));
            const height = 1 + (view[27] | (view[28] << 8) | (view[29] << 16));
            return { width, height };
        }
        if (chunk === 'VP8 ' && view.length >= 30) {
            const width = this.readUint16LE(view, 26) & 0x3FFF;
            const height = this.readUint16LE(view, 28) & 0x3FFF;
            return { width, height };
        }
        if (chunk === 'VP8L' && view.length >= 25) {
            const b0 = view[21] || 0;
            const b1 = view[22] || 0;
            const b2 = view[23] || 0;
            const b3 = view[24] || 0;
            const width = 1 + (((b1 & 0x3F) << 8) | b0);
            const height = 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6));
            return { width, height };
        }
        return { width: 0, height: 0 };
    }

    detectJpegDimensions(bytes) {
        let offset = 2;
        while (offset + 9 < bytes.length) {
            if (bytes[offset] !== 0xFF) {
                offset += 1;
                continue;
            }
            const marker = bytes[offset + 1];
            const segmentLength = this.readUint16BE(bytes, offset + 2);
            if (segmentLength < 2) break;
            const isSof = marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3 || marker === 0xC5 || marker === 0xC6 || marker === 0xC7 || marker === 0xC9 || marker === 0xCA || marker === 0xCB || marker === 0xCD || marker === 0xCE || marker === 0xCF;
            if (isSof && offset + 8 < bytes.length) {
                const height = this.readUint16BE(bytes, offset + 5);
                const width = this.readUint16BE(bytes, offset + 7);
                return { width, height };
            }
            offset += 2 + segmentLength;
        }
        return { width: 0, height: 0 };
    }

    readUint16LE(bytes, offset) {
        if (offset + 1 >= bytes.length) return 0;
        return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8);
    }

    readUint16BE(bytes, offset) {
        if (offset + 1 >= bytes.length) return 0;
        return ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0);
    }

    readUint32BE(bytes, offset) {
        if (offset + 3 >= bytes.length) return 0;
        return ((bytes[offset] || 0) << 24) >>> 0
            | ((bytes[offset + 1] || 0) << 16)
            | ((bytes[offset + 2] || 0) << 8)
            | (bytes[offset + 3] || 0);
    }

    applyImageSizeToFilename(filename, width = 0, height = 0) {
        const safeWidth = Number(width || 0);
        const safeHeight = Number(height || 0);
        if (!safeWidth || !safeHeight) return filename;
        return String(filename || '').replace(
            /aigc_resize[_:]\d{2,5}[_:]\d{2,5}/i,
            `aigc_resize_${safeWidth}_${safeHeight}`
        );
    }

    getReferrerForUrl(url, pageUrl = '') {
        const page = String(pageUrl || '').toLowerCase();
        const target = String(url || '').toLowerCase();
        if (page.includes('dreamina.capcut.com')) return 'https://dreamina.capcut.com/';
        if (page.includes('jimeng.jianying.com')) return 'https://jimeng.jianying.com/';
        if (/byteimg\.com|zijiecdn\.com|bytecdn\.com|pstatp\.com|faceu-img\.com|vlabvod\.com/.test(target)) {
            return 'https://jimeng.jianying.com/';
        }
        if (/capcut-os.*\.bytedance\.net/.test(target)) {
            return 'https://dreamina.capcut.com/';
        }
        return '';
    }

    async downloadBlob(blob, filename) {
        if (typeof URL.createObjectURL !== 'function') {
            throw this.createError('URL.createObjectURL 不可用', { code: 'no-createObjectURL' });
        }
        const objectUrl = URL.createObjectURL(blob);
        try {
            const result = await this.downloadDirect(objectUrl, filename);
            return { ...result, method: 'blob' };
        } finally {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
        }
    }

    buildImageCandidateEntries(url, source = '', extraImageCandidates = []) {
        const entries = [];
        const add = (value, entrySource, origin = 'selected') => {
            const text = String(value || '').trim();
            if (!text) return;
            entries.push({
                url: text,
                source: String(entrySource || origin || 'unknown'),
                origin
            });
        };

        add(url, source || 'selected-image', 'selected');

        if (Array.isArray(extraImageCandidates)) {
            extraImageCandidates.forEach((item) => {
                if (!item) return;
                if (typeof item === 'string') {
                    add(item, 'extra-image-candidate', 'extra');
                    return;
                }
                if (typeof item === 'object') {
                    add(item.url, item.source || 'extra-image-candidate', 'extra');
                }
            });
        }

        const seen = new Set();
        const deduped = [];
        entries.forEach((entry) => {
            const key = this.normalizeCandidateKey(entry.url);
            if (!key || seen.has(key)) return;
            seen.add(key);
            deduped.push(entry);
        });
        return deduped;
    }

    normalizeCandidateKey(url) {
        const text = String(url || '').trim();
        if (!text) return '';
        try {
            return new URL(text).toString();
        } catch {
            return text;
        }
    }

    buildImageUrlVariants(url) {
        const variants = [];
        const push = (value, variant) => {
            const text = String(value || '').trim();
            if (!text) return;
            variants.push({ url: text, variant });
        };

        try {
            const parsed = new URL(url);
            push(parsed.toString(), 'original');
            const pathname = parsed.pathname || '';
            const markerIndex = pathname.indexOf('~');
            if (markerIndex !== -1) {
                const cleanPath = pathname.slice(0, markerIndex);
                if (cleanPath) {
                    const cleanUrl = new URL(parsed.toString());
                    cleanUrl.pathname = cleanPath;
                    push(cleanUrl.toString(), 'strip-variant');

                    const noopUrl = new URL(cleanUrl.toString());
                    noopUrl.pathname = `${cleanPath}~tplv-noop.image`;
                    push(noopUrl.toString(), 'strip-variant+noop');

                    const originalExt = this.extractExtension(parsed.toString()) || this.extractExtension(cleanPath);
                    if (originalExt && !cleanPath.toLowerCase().endsWith(`.${originalExt}`)) {
                        const extUrl = new URL(cleanUrl.toString());
                        extUrl.pathname = `${cleanPath}.${originalExt}`;
                        push(extUrl.toString(), 'strip-variant+ext');

                        const extNoopUrl = new URL(cleanUrl.toString());
                        extNoopUrl.pathname = `${cleanPath}.${originalExt}~tplv-noop.image`;
                        push(extNoopUrl.toString(), 'strip-variant+ext+noop');
                    }
                }
            }
        } catch {
            push(url, 'raw');
        }

        const seen = new Set();
        return variants.filter((item) => {
            const key = this.normalizeCandidateKey(item.url);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    buildFilename(filename, url, { mediaType = '', contentType = '' } = {}) {
        const cleanName = (filename || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
        const fallbackBase = mediaType === 'video' ? 'jimeng-video' : mediaType === 'image' ? 'jimeng-image' : 'download';

        let baseName = cleanName || `${fallbackBase}-${Date.now()}`;
        const ext = this.extractExtension(baseName) || this.extractExtension(url) || this.extensionFromContentType(contentType) || (mediaType === 'video' ? 'mp4' : mediaType === 'image' ? 'jpg' : 'bin');

        if (!this.extractExtension(baseName)) {
            baseName = `${baseName}.${ext}`;
        }

        if (baseName.length > 200) {
            const dotIndex = baseName.lastIndexOf('.');
            const suffix = dotIndex > 0 ? baseName.slice(dotIndex) : `.${ext}`;
            baseName = `${baseName.slice(0, Math.max(1, 200 - suffix.length))}${suffix}`;
        }

        return baseName;
    }

    detectMediaType(url, filename = '') {
        const lower = `${url || ''} ${filename || ''}`.toLowerCase();
        if (/(\.mp4|\.mov|\.webm|\.m3u8)(\?|$)|mime_type=video|media_type=video/.test(lower)) return 'video';
        if (/(\.jpg|\.jpeg|\.png|\.webp|\.gif|\.bmp)(\?|$)|mime_type=image|media_type=image/.test(lower)) return 'image';
        return '';
    }

    extractExtension(value) {
        if (!value) return '';
        try {
            const parsed = new URL(value);
            const pathname = parsed.pathname || '';
            const leaf = pathname.split('/').pop() || '';
            const match = leaf.match(/\.([a-zA-Z0-9]{2,8})$/);
            return match ? match[1].toLowerCase() : '';
        } catch {
            const leaf = String(value).split(/[?#]/)[0].split('/').pop() || '';
            const match = leaf.match(/\.([a-zA-Z0-9]{2,8})$/);
            return match ? match[1].toLowerCase() : '';
        }
    }

    extensionFromContentType(contentType) {
        const type = String(contentType || '').toLowerCase();
        if (type.includes('jpeg')) return 'jpg';
        if (type.includes('png')) return 'png';
        if (type.includes('webp')) return 'webp';
        if (type.includes('gif')) return 'gif';
        if (type.includes('bmp')) return 'bmp';
        if (type.includes('mp4')) return 'mp4';
        if (type.includes('webm')) return 'webm';
        if (type.includes('quicktime')) return 'mov';
        return '';
    }

    createError(message, details = {}) {
        const error = new Error(message || '下载失败');
        error.details = details;
        return error;
    }

    classifyErrorCode(message = '') {
        const text = String(message || '').toLowerCase();
        if (!text) return 'unknown';
        if (text.includes('invalid url') || text.includes('invalid argument')) return 'invalid-url';
        if (text.includes('cors') || text.includes('failed to fetch') || text.includes('networkerror')) return 'cors-or-network';
        if (text.includes('user canceled')) return 'user-canceled';
        if (text.includes('forbidden') || text.includes('403')) return 'http-403';
        if (text.includes('unauthorized') || text.includes('401')) return 'http-401';
        if (text.includes('404')) return 'http-404';
        return 'request-failed';
    }

    looksLikeImageUrl(url) {
        const text = String(url || '').toLowerCase();
        if (!text) return false;
        return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/.test(text)
            || text.includes('aigc_resize')
            || text.includes('tplv-');
    }

    shouldQueueDirectFallback(error, url, source = '') {
        if (!this.looksLikeImageUrl(url)) return false;
        if (String(source || '').startsWith('raw-text-')) return false;
        const code = String(error?.details?.code || this.classifyErrorCode(error?.message || '') || '');
        if (!code) return false;
        if (code === 'empty-blob' || code === 'invalid-url') return false;
        if (code === 'unexpected-content-type') return false;
        if (code === 'cors-or-network' || code === 'request-failed') return true;
        if (code === 'http-401' || code === 'http-403' || code === 'http-404' || code.startsWith('http-')) return false;
        return false;
    }

    formatErrorDetails(error, fallback = {}) {
        const details = (error && typeof error.details === 'object') ? error.details : {};
        const message = String(error?.message || details?.message || fallback?.message || '下载失败');
        return {
            code: String(details.code || fallback.code || this.classifyErrorCode(message)),
            message,
            status: Number(details.status || fallback.status || 0) || undefined,
            ...Object.fromEntries(
                Object.entries({ ...fallback, ...details })
                    .filter(([key]) => !['code', 'message', 'status'].includes(key))
            )
        };
    }

    summarizeFailureTrace(trace) {
        const buckets = {};
        trace?.candidates?.forEach((candidate) => {
            candidate?.variants?.forEach((variant) => {
                variant?.attempts?.forEach((attempt) => {
                    if (attempt?.ok) return;
                    const code = String(attempt?.code || 'unknown');
                    buckets[code] = (buckets[code] || 0) + 1;
                });
            });
        });
        const summary = Object.entries(buckets)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([code, count]) => `${code}x${count}`)
            .join(', ');
        return summary || '无可用候选';
    }

    recordDownloadTrace(trace) {
        const payload = {
            ...trace,
            candidates: Array.isArray(trace?.candidates) ? trace.candidates : [],
            recordedAt: Date.now()
        };
        this.downloadDiagnostics.unshift(payload);
        if (this.downloadDiagnostics.length > this.maxDiagnostics) {
            this.downloadDiagnostics.length = this.maxDiagnostics;
        }
    }

}

new BackgroundService();
