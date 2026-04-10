const FLOATING_DOWNLOAD_KEY = 'floatingDownloadEnabled';
const FLOATING_DOWNLOAD_ROOT_ID = 'zhizix-jimeng-floating-download';
const DEBUG_ENABLED = false;
const BRIDGED_WORK_DETAIL_TTL = 3000;
const HARD_NAV_SESSION_PREFIX = '__seedance_hard_nav__';
const HARD_NAV_SESSION_TTL = 20000;

class JimengMediaCollector {
    constructor() {
        this.mediaItems = [];
        this.scanTimeout = null;
        this.hydrationTimeout = null;
        this.observer = null;
        this.lastPageUrl = location.href;
        this.lastDetailIdentity = '';
        this.lastDetailMediaKey = '';
        this.bridgedWorkDetailData = null;
        this.bridgedWorkDetailUrl = '';
        this.bridgedWorkDetailMeta = null;
        this.documentRouterPayload = null;
        this.documentRouterPayloadKey = '';
        this.rawTextMediaCache = null;
        this.rawTextMediaCacheKey = '';
        this.rawTextImageCandidatesCache = null;
        this.rawTextImageCandidatesCacheKey = '';
        this.rawTextVideoCandidatesCache = null;
        this.rawTextVideoCandidatesCacheKey = '';
        this.officialWorkDetailData = null;
        this.officialWorkDetailKey = '';
        this.officialWorkDetailPromise = null;
        this.detailDataHydrated = false;
        this.floatingDownloadEnabled = true;
        this.floatingButtonRoot = null;
        this.floatingButtonEl = null;
        this.floatingTabParseEl = null;
        this.floatingButtonTarget = null;
        this.floatingButtonItem = null;
        this.positionUpdateRaf = 0;
        this.boundFloatingButtonReposition = () => this.scheduleFloatingButtonUpdate();
        this.boundStorageChange = (changes, areaName) => this.handleStorageChange(changes, areaName);
        this.boundDocumentLoad = (event) => this.handleDocumentLoad(event);
        window.addEventListener('message', (event) => this.handleWindowMessage(event));
        chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
            this.handleMessage(request, sendResponse);
            return true;
        });
        this.setupObserver();
        this.bindFloatingButtonPageEvents();
        chrome.storage.onChanged.addListener(this.boundStorageChange);
        this.scanMedia();
        this.init();
    }

    async init() {
        try {
            await this.loadFloatingDownloadSetting();
            await this.refreshActiveDetailData({ force: true });
        } catch {
        } finally {
            this.detailDataHydrated = true;
            this.scanMedia();
        }
    }

    handleWindowMessage(event) {
        if (event.source !== window) return;
        if (event.data?.type === 'jimeng-page-change') {
            this.handlePageChange(event.data.url);
            return;
        }
        if (event.data?.type === 'jimeng-work-detail') {
            this.handleBridgedWorkDetail(event.data);
            return;
        }
    }

    debug(event, details = {}) {
        if (!DEBUG_ENABLED) return;
        console.debug('[seedance-content]', event, {
            ...details,
            href: location.href,
            ts: Date.now()
        });
    }

    getWorkDetailIdCandidates(workDetail) {
        if (!workDetail || typeof workDetail !== 'object') return [];
        return [
            workDetail.publishedItemId,
            workDetail.published_item_id,
            workDetail.itemId,
            workDetail.item_id,
            workDetail.effectId,
            workDetail.effect_id,
            workDetail.id,
            workDetail.value?.publishedItemId,
            workDetail.value?.published_item_id,
            workDetail.value?.itemId,
            workDetail.value?.item_id,
            workDetail.value?.effectId,
            workDetail.value?.effect_id,
            workDetail.value?.id,
            workDetail.item?.publishedItemId,
            workDetail.item?.published_item_id,
            workDetail.item?.itemId,
            workDetail.item?.item_id,
            workDetail.item?.effectId,
            workDetail.item?.effect_id,
            workDetail.item?.id
        ].filter(Boolean).map((value) => String(value));
    }

    getWorkDetailPrimaryMediaKey(workDetail, strategy = this.getPageStrategy()) {
        if (!workDetail || typeof workDetail !== 'object') return '';
        if (strategy.mediaType === 'video') {
            const videoInfo = workDetail.video
                || workDetail.videoInfo
                || workDetail.video_info
                || workDetail.value?.video
                || workDetail.value?.videoInfo
                || workDetail.value?.video_info
                || workDetail.item?.video
                || workDetail.item?.videoInfo
                || workDetail.item?.video_info
                || null;
            const commonAttr = workDetail.commonAttr
                || workDetail.common_attr
                || workDetail.value?.commonAttr
                || workDetail.value?.common_attr
                || workDetail.item?.commonAttr
                || workDetail.item?.common_attr
                || null;
            const candidates = [
                videoInfo?.originVideo?.videoUrl,
                videoInfo?.originVideo?.video_url,
                videoInfo?.originVideoUrl,
                videoInfo?.origin_video_url,
                ...Object.values(videoInfo?.transcodedVideo || videoInfo?.transcoded_video || {}).map((item) => item?.videoUrl || item?.video_url || item?.url),
                ...(Array.isArray((videoInfo?.playAddr || videoInfo?.play_addr)?.urlList) ? (videoInfo?.playAddr || videoInfo?.play_addr).urlList : []),
                ...(Array.isArray((videoInfo?.playAddr || videoInfo?.play_addr)?.url_list) ? (videoInfo?.playAddr || videoInfo?.play_addr).url_list : []),
                ...(Array.isArray((videoInfo?.playAddr || videoInfo?.play_addr)?.urls) ? (videoInfo?.playAddr || videoInfo?.play_addr).urls : []),
                (videoInfo?.playAddr || videoInfo?.play_addr)?.url,
                (videoInfo?.playAddr || videoInfo?.play_addr)?.mainUrl,
                ...(Array.isArray(commonAttr?.itemUrls) ? commonAttr.itemUrls : []),
                ...(Array.isArray(commonAttr?.item_urls) ? commonAttr.item_urls : []),
                ...(Array.isArray(workDetail.itemUrls) ? workDetail.itemUrls : []),
                ...(Array.isArray(workDetail.item_urls) ? workDetail.item_urls : []),
                videoInfo?.videoUrl,
                videoInfo?.video_url,
                videoInfo?.url
            ].map((value) => this.normalizeUrl(value)).find(Boolean);
            return candidates ? (this.describeVideoUrl(candidates).groupKey || candidates) : '';
        }

        const imageCandidates = [
            ...this.collectImageCandidatesFromWorkDetail(workDetail, 'largeImages', '', { strict: false, sourcePrefix: 'router' }),
            ...this.collectImageCandidatesFromWorkDetail(workDetail, 'coverUrlMap', '', { strict: false, sourcePrefix: 'router' }),
            ...this.collectImageCandidatesFromWorkDetail(workDetail, 'coverUrl', '', { strict: false, sourcePrefix: 'router' })
        ];
        const imageUrl = this.normalizeUrl(imageCandidates[0]?.url);
        return imageUrl ? (this.extractAssetKey(imageUrl) || imageUrl) : '';
    }

    getCurrentBridgeMatchState(meta = this.bridgedWorkDetailMeta, strategy = this.getPageStrategy()) {
        if (!meta) return { matched: false, reason: 'missing-meta' };
        if ((Date.now() - Number(meta.capturedAt || 0)) > BRIDGED_WORK_DETAIL_TTL) {
            return { matched: false, reason: 'expired' };
        }

        const currentItemId = String(this.getPublishedItemId() || '');
        const currentDetailIdentity = this.getCurrentDetailIdentity(strategy);
        const currentDetailMediaKey = this.getCurrentDetailMediaKey(strategy);
        const bridgeItemId = String(meta.publishedItemId || '');
        const bridgeMediaKey = String(meta.detailMediaKey || '');
        const bridgeIdentity = bridgeItemId
            ? `${strategy.mediaType || 'detail'}:${bridgeItemId}`
            : '';

        if (currentItemId && bridgeItemId && currentItemId === bridgeItemId) {
            return { matched: true, reason: 'published-item-id', currentDetailIdentity, currentDetailMediaKey };
        }
        if (currentDetailIdentity && bridgeIdentity && currentDetailIdentity === bridgeIdentity) {
            return { matched: true, reason: 'detail-identity', currentDetailIdentity, currentDetailMediaKey };
        }
        if (currentDetailMediaKey && bridgeMediaKey && currentDetailMediaKey === bridgeMediaKey) {
            return { matched: true, reason: 'detail-media-key', currentDetailIdentity, currentDetailMediaKey };
        }
        if (this.isJimengHost()) {
            const lock = this.getCurrentDetailLock(strategy);
            if (lock?.signatures?.has(bridgeMediaKey)) {
                return { matched: true, reason: 'detail-lock-signature', currentDetailIdentity, currentDetailMediaKey };
            }
        }

        return {
            matched: false,
            reason: 'identity-mismatch',
            currentItemId,
            currentDetailIdentity,
            currentDetailMediaKey,
            bridgeItemId,
            bridgeIdentity,
            bridgeMediaKey
        };
    }

    invalidateBridgedWorkDetail(reason = 'manual') {
        if (!this.bridgedWorkDetailData && !this.bridgedWorkDetailMeta) return;
        this.debug('invalidate-bridged-work-detail', {
            reason,
            bridgeItemId: this.bridgedWorkDetailMeta?.publishedItemId || '',
            bridgeMediaKey: this.bridgedWorkDetailMeta?.detailMediaKey || ''
        });
        this.bridgedWorkDetailData = null;
        this.bridgedWorkDetailUrl = '';
        this.bridgedWorkDetailMeta = null;
    }

    handleBridgedWorkDetail(data) {
        const workDetail = data?.workDetail;
        if (!workDetail || typeof workDetail !== 'object') return;

        const strategy = this.getPageStrategy();
        const bridgeMeta = {
            url: typeof data?.url === 'string' ? data.url : location.href,
            publishedItemId: String(data?.publishedItemId || this.getWorkDetailIdCandidates(workDetail)[0] || ''),
            detailMediaKey: String(data?.detailMediaKey || this.getWorkDetailPrimaryMediaKey(workDetail, strategy) || ''),
            sourceKind: String(data?.sourceKind || 'bridge-router'),
            capturedAt: Number(data?.capturedAt || Date.now()),
            signature: String(data?.signature || '')
        };

        this.bridgedWorkDetailData = workDetail;
        this.bridgedWorkDetailUrl = bridgeMeta.url;
        this.bridgedWorkDetailMeta = bridgeMeta;

        const matchState = this.getCurrentBridgeMatchState(bridgeMeta, strategy);
        this.debug('receive-bridged-work-detail', {
            source: bridgeMeta.sourceKind,
            bridgeItemId: bridgeMeta.publishedItemId,
            bridgeMediaKey: bridgeMeta.detailMediaKey,
            signature: bridgeMeta.signature,
            matched: matchState.matched,
            reason: matchState.reason
        });

        if (!matchState.matched) {
            this.invalidateBridgedWorkDetail(matchState.reason);
            return;
        }

        this.lastDetailMediaKey = this.getCurrentDetailMediaKey(strategy) || this.lastDetailMediaKey;
        this.detailDataHydrated = true;
        this.scheduleScan(20);
    }

    setupObserver() {
        this.observer = new MutationObserver(() => {
            this.scheduleScan(300);
        });

        this.observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'poster', 'style', 'class', 'data-src', 'data-original']
        });
    }

    scheduleScan(delay = 200) {
        clearTimeout(this.scanTimeout);
        this.scanTimeout = setTimeout(() => this.scanMedia(), delay);
    }

    scheduleDetailHydration(delay = 120) {
        clearTimeout(this.hydrationTimeout);
        this.hydrationTimeout = setTimeout(async () => {
            this.hydrationTimeout = null;
            try {
                await this.refreshActiveDetailData({ force: true });
            } catch {
            } finally {
                this.detailDataHydrated = true;
                this.scanMedia();
            }
        }, delay);
    }

    resetDetailDataState() {
        this.mediaItems = [];
        this.lastDetailIdentity = '';
        this.lastDetailMediaKey = '';
        this.bridgedWorkDetailData = null;
        this.bridgedWorkDetailUrl = '';
        this.bridgedWorkDetailMeta = null;
        this.documentRouterPayload = null;
        this.documentRouterPayloadKey = '';
        this.rawTextMediaCache = null;
        this.rawTextMediaCacheKey = '';
        this.rawTextImageCandidatesCache = null;
        this.rawTextImageCandidatesCacheKey = '';
        this.rawTextVideoCandidatesCache = null;
        this.rawTextVideoCandidatesCacheKey = '';
        this.officialWorkDetailData = null;
        this.officialWorkDetailKey = '';
        this.officialWorkDetailPromise = null;
    }

    async loadFloatingDownloadSetting() {
        try {
            const data = await chrome.storage.local.get([FLOATING_DOWNLOAD_KEY]);
            this.floatingDownloadEnabled = data[FLOATING_DOWNLOAD_KEY] !== false;
        } catch {
            this.floatingDownloadEnabled = true;
        }
    }

    setFloatingDownloadEnabled(enabled) {
        this.floatingDownloadEnabled = Boolean(enabled);
        this.updateFloatingButton();
    }

    handleStorageChange(changes, areaName) {
        if (areaName !== 'local') return;
        if (!changes[FLOATING_DOWNLOAD_KEY]) return;
        this.setFloatingDownloadEnabled(Boolean(changes[FLOATING_DOWNLOAD_KEY].newValue));
    }

    bindFloatingButtonPageEvents() {
        window.addEventListener('scroll', this.boundFloatingButtonReposition, true);
        window.addEventListener('resize', this.boundFloatingButtonReposition, true);
        document.addEventListener('visibilitychange', this.boundFloatingButtonReposition, true);
        document.addEventListener('load', this.boundDocumentLoad, true);
    }

    ensureFloatingButton() {
        if (this.floatingButtonRoot?.isConnected && this.floatingButtonEl?.isConnected) {
            return this.floatingButtonEl;
        }

        const existing = document.getElementById(FLOATING_DOWNLOAD_ROOT_ID);
        if (existing) {
            this.floatingButtonRoot = existing;
            this.floatingButtonEl = existing.querySelector('[data-role="quick"]');
            this.floatingTabParseEl = existing.querySelector('[data-role="tab-parse"]');
            if (this.floatingButtonEl) return this.floatingButtonEl;
        }

        const root = document.createElement('div');
        root.id = FLOATING_DOWNLOAD_ROOT_ID;
        root.style.position = 'fixed';
        root.style.left = '0';
        root.style.top = '0';
        root.style.zIndex = '2147483647';
        root.style.display = 'none';
        root.style.pointerEvents = 'none';
        root.style.cssText += 'display:none;gap:6px;';

        const btnStyle = 'pointer-events:auto;border:none;border-radius:999px;padding:10px 16px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;';

        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.role = 'quick';
        button.textContent = '去水印下载';
        button.style.cssText = btnStyle + 'background:linear-gradient(135deg,#2563eb,#1d4ed8);box-shadow:0 10px 24px rgba(37,99,235,0.28);';
        button.addEventListener('click', () => this.handleFloatingButtonClick());

        const tabParseBtn = document.createElement('button');
        tabParseBtn.type = 'button';
        tabParseBtn.dataset.role = 'tab-parse';
        tabParseBtn.textContent = '原画解析下载';
        tabParseBtn.style.cssText = btnStyle + 'background:linear-gradient(135deg,#16a34a,#15803d);box-shadow:0 10px 24px rgba(22,163,74,0.28);display:none;';
        tabParseBtn.addEventListener('click', () => this.handleFloatingTabParseClick());

        root.appendChild(button);
        root.appendChild(tabParseBtn);
        document.body.appendChild(root);
        this.floatingButtonRoot = root;
        this.floatingButtonEl = button;
        this.floatingTabParseEl = tabParseBtn;
        return button;
    }

    scheduleFloatingButtonUpdate() {
        if (this.positionUpdateRaf) cancelAnimationFrame(this.positionUpdateRaf);
        this.positionUpdateRaf = requestAnimationFrame(() => {
            this.positionUpdateRaf = 0;
            this.updateFloatingButton();
        });
    }

    updateFloatingButton() {
        if (!this.floatingDownloadEnabled || document.visibilityState === 'hidden') {
            this.hideFloatingButton();
            return;
        }

        const strategy = this.getPageStrategy();
        if (!strategy.supported) {
            this.hideFloatingButton();
            return;
        }

        if (!this.detailDataHydrated) {
            const anchor = this.getPrimaryAnchorTarget(strategy);
            if (!anchor) {
                this.hideFloatingButton();
                return;
            }
            this.showFloatingButton(anchor, null, { parsing: true, mediaType: strategy.mediaType });
            return;
        }

        const target = this.getPrimaryFloatingTarget();
        if (!target?.element || !target?.item) {
            this.hideFloatingButton();
            return;
        }

        this.showFloatingButton(target.element, target.item, { parsing: false, mediaType: strategy.mediaType });
    }

    getPrimaryAnchorTarget(strategy) {
        if (strategy.mediaType === 'video') {
            return this.getMainVideoElements()[0] || null;
        }
        if (strategy.mediaType === 'image') {
            return this.getMainImageElements()[0] || null;
        }
        return this.getMainVideoElements()[0] || this.getMainImageElements()[0] || null;
    }

    getPrimaryFloatingTarget() {
        const strategy = this.getPageStrategy();
        if (!strategy.supported || !this.mediaItems.length) return null;

        if (strategy.mediaType === 'video') {
            const element = this.getMainVideoElements()[0];
            const item = this.mediaItems.find((mediaItem) => mediaItem.type === 'video') || null;
            return element && item ? { element, item } : null;
        }

        if (strategy.mediaType === 'image') {
            const element = this.getMainImageElements()[0];
            const item = this.mediaItems.find((mediaItem) => mediaItem.type === 'image') || null;
            return element && item ? { element, item } : null;
        }

        const videoElement = this.getMainVideoElements()[0];
        const videoItem = this.mediaItems.find((mediaItem) => mediaItem.type === 'video') || null;
        if (videoElement && videoItem) return { element: videoElement, item: videoItem };

        const imageElement = this.getMainImageElements()[0];
        const imageItem = this.mediaItems.find((mediaItem) => mediaItem.type === 'image') || null;
        return imageElement && imageItem ? { element: imageElement, item: imageItem } : null;
    }

    showFloatingButton(element, item, { parsing = false, mediaType = null } = {}) {
        const button = this.ensureFloatingButton();
        this.floatingButtonTarget = element;
        this.floatingButtonItem = item;
        if (parsing) {
            button.textContent = mediaType === 'video' ? '解析视频中...' : mediaType === 'image' ? '解析图片中...' : '解析中...';
            button.disabled = true;
            button.style.opacity = '0.82';
            button.style.cursor = 'default';
        } else {
            button.textContent = item.type === 'video' ? '去水印下载视频' : '去水印下载图片';
            button.disabled = false;
            button.style.opacity = '1';
            button.style.cursor = 'pointer';
        }

        const isJimengDetail = this.isJimengHost()
            && !location.pathname.includes('/ai-tool/generate')
            && !location.pathname.includes('/ai-tool/canvas');
        if (this.floatingTabParseEl) {
            if (isJimengDetail && !parsing) {
                this.floatingTabParseEl.style.display = 'block';
                this.floatingTabParseEl.disabled = false;
                button.textContent = '快速去水印下载';
            } else {
                this.floatingTabParseEl.style.display = 'none';
            }
        }

        this.positionFloatingButton();
        this.floatingButtonRoot.style.display = 'flex';
    }

    positionFloatingButton() {
        if (!this.floatingButtonRoot || !this.floatingButtonTarget?.isConnected) {
            this.hideFloatingButton();
            return;
        }

        const rect = this.floatingButtonTarget.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            this.hideFloatingButton();
            return;
        }

        const top = Math.max(12, rect.top + 12);
        const left = Math.min(
            window.innerWidth - this.floatingButtonRoot.offsetWidth - 12,
            Math.max(12, rect.left + rect.width - this.floatingButtonRoot.offsetWidth - 12)
        );

        this.floatingButtonRoot.style.top = `${Math.round(top)}px`;
        this.floatingButtonRoot.style.left = `${Math.round(left)}px`;
    }

    hideFloatingButton() {
        if (this.floatingButtonRoot) this.floatingButtonRoot.style.display = 'none';
        this.floatingButtonTarget = null;
        this.floatingButtonItem = null;
    }

    async handleFloatingButtonClick() {
        if (!this.floatingButtonItem || !this.floatingButtonEl) return;

        const originalText = this.floatingButtonEl.textContent;
        this.floatingButtonEl.disabled = true;
        this.floatingButtonEl.textContent = '下载中...';

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'downloadFile',
                url: this.floatingButtonItem.url,
                filename: this.floatingButtonItem.filename,
                mediaType: this.floatingButtonItem.type,
                source: this.floatingButtonItem.source,
                extraImageCandidates: this.floatingButtonItem.type === 'image'
                    ? this.floatingButtonItem.extraImageCandidates || []
                    : [],
                preferBlob: false,
                pageUrl: location.href
            });

            this.floatingButtonEl.textContent = response?.success ? '已开始' : '失败';
        } catch {
            this.floatingButtonEl.textContent = '失败';
        }

        setTimeout(() => {
            if (!this.floatingButtonEl) return;
            this.floatingButtonEl.disabled = false;
            this.floatingButtonEl.textContent = originalText;
        }, 1500);
    }

    async handleFloatingTabParseClick() {
        if (!this.floatingTabParseEl) return;

        const originalText = this.floatingTabParseEl.textContent;
        this.floatingTabParseEl.disabled = true;
        this.floatingTabParseEl.textContent = '原画解析中...';

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'downloadWithTab',
                detailUrl: location.href,
                pageUrl: location.href
            });

            this.floatingTabParseEl.textContent = response?.success ? '已开始' : '失败';
        } catch {
            this.floatingTabParseEl.textContent = '失败';
        }

        setTimeout(() => {
            if (!this.floatingTabParseEl) return;
            this.floatingTabParseEl.disabled = false;
            this.floatingTabParseEl.textContent = originalText;
        }, 1500);
    }

    handleMessage(request, sendResponse) {
        try {
            if (request.action === 'getStatus') {
                if (this.isDreaminaHost() && this.getPageStrategy().mediaType === 'image') {
                    const hasOriginal = this.mediaItems.some(item =>
                        item.type === 'image' && (item.url?.includes('aigc_resize:0:0') || item.url?.includes('aigc_resize_0_0'))
                    );
                    if (!hasOriginal && !this.officialWorkDetailData) {
                        this.waitAndRescanForDreamina(sendResponse);
                        return;
                    }
                    this.scanMedia();
                }
                sendResponse(this.getStatus());
                return;
            }

            if (request.action === 'startTabParse') {
                this.handleTabParse(sendResponse);
                return;
            }

            if (request.action === 'setFloatingDownloadEnabled') {
                this.setFloatingDownloadEnabled(request.enabled);
                sendResponse({ success: true });
                return;
            }

            if (request.action === 'downloadFile') {
                chrome.runtime.sendMessage(request, sendResponse);
                return;
            }

            sendResponse({ success: false, error: 'Unknown action' });
        } catch (error) {
            sendResponse({ success: false, error: error?.message || '页面脚本处理失败' });
        }
    }

    async waitAndRescanForDreamina(sendResponse) {
        const start = Date.now();
        const maxWait = 1500;
        const interval = 150;
        while (Date.now() - start < maxWait) {
            await new Promise(r => setTimeout(r, interval));
            if (this.officialWorkDetailData) break;
        }
        this.scanMedia();
        sendResponse(this.getStatus());
    }

    async handleTabParse(sendResponse) {
        try {
            await this.withTimeout(this.refreshActiveDetailData({ force: true }), 3000);
            this.detailDataHydrated = true;
            this.scanMedia();

            const status = this.getStatus();
            chrome.runtime.sendMessage({
                action: 'tabParseComplete',
                success: status.supported && status.mediaItems.length > 0,
                mediaItems: status.mediaItems,
                error: status.supported ? null : '当前页面不支持'
            });

            sendResponse({ success: true });
        } catch (error) {
            chrome.runtime.sendMessage({
                action: 'tabParseComplete',
                success: false,
                error: error?.message || '解析失败'
            });
            sendResponse({ success: false, error: error?.message || '解析失败' });
        }
    }

    getCurrentRawText() {
        const cacheKey = String(this.getPublishedItemId() || location.href);
        if (this.rawTextMediaCache && this.rawTextMediaCacheKey === cacheKey) {
            return this.rawTextMediaCache;
        }
        if (this.rawTextMediaCacheKey !== cacheKey) {
            this.rawTextImageCandidatesCache = null;
            this.rawTextImageCandidatesCacheKey = '';
            this.rawTextVideoCandidatesCache = null;
            this.rawTextVideoCandidatesCacheKey = '';
        }

        let html = '';

        if (this.isJimengHost()) {
            const strategy = this.getPageStrategy();
            if (strategy.supported && !strategy.isGeneratePage) {
                const detailContainer = document.querySelector('[role="dialog"], [aria-modal="true"], [class*="detail"][class*="modal"], [class*="detail"][class*="drawer"]');
                if (detailContainer) {
                    html = detailContainer.innerHTML || '';
                } else {
                    html = document.documentElement?.innerHTML || '';
                }
            } else {
                html = document.documentElement?.innerHTML || '';
            }
        } else {
            html = document.documentElement?.innerHTML || '';
        }

        const normalized = this.normalizeRawText(html);

        this.rawTextMediaCache = { normalized };
        this.rawTextMediaCacheKey = cacheKey;
        return this.rawTextMediaCache;
    }

    normalizeRawText(text) {
        return text
            ? String(text)
                .replace(/\\u002F/g, '/')
                .replace(/\\\\/g, '')
                .replace(/\\\//g, '/')
                .replace(/\\"/g, '"')
            : '';
    }

    getJimengRawTextCandidateCacheKey(strategy = this.getPageStrategy()) {
        const baseKey = String(this.getPublishedItemId() || location.href);
        if (!this.isJimengHost()) return baseKey;
        if (strategy.mediaType === 'image') {
            const lock = this.getCurrentDetailLock(strategy);
            return `${baseKey}|${lock?.identity || ''}|${lock?.mediaKey || ''}`;
        }
        return `${baseKey}|${strategy.mediaType || 'detail'}`;
    }

    extractVideoCandidatesFromRawText() {
        if (!this.isJimengHost()) return [];
        const strategy = this.getPageStrategy();
        if (strategy.mediaType !== 'video') return [];

        const cacheKey = this.getJimengRawTextCandidateCacheKey(strategy);
        if (this.rawTextVideoCandidatesCache && this.rawTextVideoCandidatesCacheKey === cacheKey) {
            return this.rawTextVideoCandidatesCache;
        }

        const { normalized } = this.getCurrentRawText();
        if (!normalized) {
            this.rawTextVideoCandidatesCache = [];
            this.rawTextVideoCandidatesCacheKey = cacheKey;
            return [];
        }

        const candidates = [];
        const add = (url, source) => {
            const value = this.normalizeUrl(url);
            if (!value || !this.isValidMediaUrl(value, 'video')) return;
            candidates.push({ url: value, source });
        };

        const patterns = [
            { regex: /"originVideo"\s*:\s*\{[\s\S]*?"videoUrl"\s*:\s*"([^"]+)"/gi, source: 'raw-text-originVideo' },
            { regex: /"origin_video"\s*:\s*\{[\s\S]*?"video_url"\s*:\s*"([^"]+)"/gi, source: 'raw-text-originVideo' },
            { regex: /"transcodedVideo"\s*:\s*\{[\s\S]*?"videoUrl"\s*:\s*"([^"]+)"/gi, source: 'raw-text-transcodedVideo' },
            { regex: /"transcoded_video"\s*:\s*\{[\s\S]*?"video_url"\s*:\s*"([^"]+)"/gi, source: 'raw-text-transcodedVideo' },
            { regex: /"playAddr"\s*:\s*\{[\s\S]*?"urlList"\s*:\s*\[(.*?)\]/gi, source: 'raw-text-playAddr' },
            { regex: /"play_addr"\s*:\s*\{[\s\S]*?"url_list"\s*:\s*\[(.*?)\]/gi, source: 'raw-text-playAddr' },
            { regex: /"itemUrls"\s*:\s*\[(.*?)\]/gi, source: 'raw-text-itemUrls' },
            { regex: /"item_urls"\s*:\s*\[(.*?)\]/gi, source: 'raw-text-itemUrls' },
            { regex: /"videoUrl"\s*:\s*"([^"]+)"/gi, source: 'raw-text-videoUrl' },
            { regex: /"video_url"\s*:\s*"([^"]+)"/gi, source: 'raw-text-videoUrl' }
        ];

        patterns.forEach(({ regex, source }) => {
            let match;
            while ((match = regex.exec(normalized))) {
                if (source === 'raw-text-playAddr' || source === 'raw-text-itemUrls') {
                    const urlMatches = match[1]?.match(/https?:\/\/[^",\]\s]+/g) || [];
                    urlMatches.forEach((url) => add(url, source));
                } else {
                    add(match[1], source);
                }
            }
        });

        this.rawTextVideoCandidatesCache = candidates;
        this.rawTextVideoCandidatesCacheKey = cacheKey;
        return candidates;
    }

    extractImageCandidatesFromRawText(level) {
        if (!this.isJimengHost()) return [];
        const strategy = this.getPageStrategy();
        if (strategy.mediaType !== 'image') return [];

        const cacheKey = this.getJimengRawTextCandidateCacheKey(strategy);
        if (this.rawTextImageCandidatesCache && this.rawTextImageCandidatesCacheKey === cacheKey) {
            return this.rawTextImageCandidatesCache[level] || [];
        }

        const { normalized } = this.getCurrentRawText();
        if (!normalized) {
            this.rawTextImageCandidatesCache = {
                coverUrlMap: [],
                coverUrl: [],
                largeImages: [],
                originalImage: []
            };
            this.rawTextImageCandidatesCacheKey = cacheKey;
            return [];
        }

        this.rawTextImageCandidatesCache = {
            coverUrlMap: this.extractImageCandidatesFromText('coverUrlMap', normalized, { sourcePrefix: 'raw-text', strategy }),
            coverUrl: this.extractImageCandidatesFromText('coverUrl', normalized, { sourcePrefix: 'raw-text', strategy }),
            largeImages: this.extractImageCandidatesFromText('largeImages', normalized, { sourcePrefix: 'raw-text', strategy }),
            originalImage: this.extractOriginalImageFromText(normalized, { sourcePrefix: 'raw-text', strategy })
        };
        this.rawTextImageCandidatesCacheKey = cacheKey;
        return this.rawTextImageCandidatesCache[level] || [];
    }

    extractDreaminaOriginalImage() {
        if (!this.isDreaminaHost()) return [];
        const strategy = this.getPageStrategy();
        if (strategy.mediaType !== 'image') return [];
        const html = document.documentElement.innerHTML || '';
        if (!html) return [];
        return this.extractOriginalImageFromText(html, { sourcePrefix: 'dreamina-raw' });
    }

    extractOriginalImageFromText(normalized, { sourcePrefix = 'raw-text', strategy = this.getPageStrategy() } = {}) {
        if (!normalized) return [];

        const candidates = [];
        const add = (url, source) => {
            const value = this.normalizeUrl(url);
            if (!value || !this.isValidMediaUrl(value, 'image')) return;
            if (!value.includes('aigc_resize:0:0') && !value.includes('aigc_resize_0_0')) return;
            candidates.push({ url: value, source });
        };

        const originalImageRegex = /https?:\/\/[^"\s]+~tplv-[^"\s]*aigc_resize:0:0[^"\s]*/gi;
        let match;
        while ((match = originalImageRegex.exec(normalized))) {
            add(match[0], `${sourcePrefix}-originalImage-0`);
        }

        const seen = new Set();
        return candidates.filter((item) => {
            const key = this.normalizeUrl(item?.url);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    extractImageCandidatesFromText(level, normalized, { sourcePrefix = 'raw-text', strategy = this.getPageStrategy() } = {}) {
        if (!normalized) return [];

        const lock = this.getCurrentDetailLock(strategy);
        const currentItemId = String(this.getPublishedItemId() || '');
        const blocks = [];
        const quotedItemId = currentItemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (quotedItemId) {
            const itemIdRegexes = [
                new RegExp(`"publishedItemId"\\s*:\\s*"?${quotedItemId}"?[\\s\\S]{0,60000}`, 'gi'),
                new RegExp(`"published_item_id"\\s*:\\s*"?${quotedItemId}"?[\\s\\S]{0,60000}`, 'gi'),
                new RegExp(`"itemId"\\s*:\\s*"?${quotedItemId}"?[\\s\\S]{0,60000}`, 'gi'),
                new RegExp(`"item_id"\\s*:\\s*"?${quotedItemId}"?[\\s\\S]{0,60000}`, 'gi')
            ];
            itemIdRegexes.forEach((regex) => {
                let match;
                while ((match = regex.exec(normalized))) {
                    blocks.push(match[0]);
                }
            });
        }
        if (!blocks.length) {
            blocks.push(normalized);
        }

        const candidates = [];
        const add = (url, source, { enforceLock = true } = {}) => {
            const value = this.normalizeUrl(url);
            if (!value || !this.isValidMediaUrl(value, 'image')) return;
            const shouldApplyLock = enforceLock && !currentItemId && lock?.signatures?.size;
            if (shouldApplyLock) {
                const assetKey = this.extractAssetKey(value);
                if (assetKey && !lock.signatures.has(assetKey) && !lock.signatures.has(value)) return;
            }
            candidates.push({ url: value, source });
        };

        const extractFromText = (blockText, { enforceLock = true } = {}) => {
            if (level === 'largeImages') {
                const regexes = [
                    /"largeImages"\s*:\s*\[(.*?)\]/gi,
                    /"large_images"\s*:\s*\[(.*?)\]/gi
                ];
                regexes.forEach((regex) => {
                    let match;
                    while ((match = regex.exec(blockText))) {
                        const urlMatches = match[1]?.match(/https?:\/\/[^",\]\s]+/g) || [];
                        urlMatches.forEach((url) => add(url, `${sourcePrefix}-largeImages`, { enforceLock }));
                    }
                });
            }

            if (level === 'coverUrlMap') {
                const regexes = [
                    /"coverUrlMap"\s*:\s*\{([\s\S]*?)\}/gi,
                    /"cover_url_map"\s*:\s*\{([\s\S]*?)\}/gi
                ];
                regexes.forEach((regex) => {
                    let match;
                    while ((match = regex.exec(blockText))) {
                        const mapBlock = match[1] || '';
                        const entryRegex = /"?(\d{1,5})"?\s*:\s*"(https?:\/\/[^"\\]+(?:\\.[^"\\]+)*)"/g;
                        let entry;
                        while ((entry = entryRegex.exec(mapBlock))) {
                            add(entry[2], `${sourcePrefix}-coverUrlMap-${entry[1]}`, { enforceLock });
                        }
                    }
                });
            }

            if (level === 'coverUrl') {
                const regexes = [
                    /"coverUrl"\s*:\s*"([^"]+)"/gi,
                    /"cover_url"\s*:\s*"([^"]+)"/gi
                ];
                regexes.forEach((regex) => {
                    let match;
                    while ((match = regex.exec(blockText))) {
                        add(match[1], `${sourcePrefix}-coverUrl`, { enforceLock });
                    }
                });
            }
        };

        blocks.forEach((blockText) => extractFromText(blockText, { enforceLock: true }));
        if (candidates.length === 0 && blocks.length > 0 && blocks[0] !== normalized) {
            extractFromText(normalized, { enforceLock: false });
        }

        const seen = new Set();
        return candidates.filter((item) => {
            const key = this.normalizeUrl(item?.url);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    getStatus() {
        this.syncPageState();
        const strategy = this.getPageStrategy();
        return {
            success: true,
            supported: strategy.supported,
            pageStrategy: strategy.mediaType || null,
            pageStrategyLabel: strategy.label,
            mediaCount: this.mediaItems.length,
            mediaItems: this.mediaItems,
            floatingDownloadEnabled: this.floatingDownloadEnabled,
            pageUrl: location.href,
            pageTitle: document.title
        };
    }

    isJimengHost() {
        return location.hostname.includes('jimeng.jianying.com');
    }

    isDreaminaHost() {
        return location.hostname === 'dreamina.capcut.com' || location.hostname.endsWith('.dreamina.capcut.com');
    }

    getCurrentSiteLabel() {
        if (this.isDreaminaHost()) return 'Dreamina';
        if (this.isJimengHost()) return '即梦';
        return '当前页面';
    }

    getPageStrategy() {
        const isJimeng = this.isJimengHost();
        const isDreamina = this.isDreaminaHost();
        if (!isJimeng && !isDreamina) {
            return { supported: false, mediaType: null, label: 'Current page is not Jimeng/Dreamina' };
        }

        const pathname = location.pathname.toLowerCase();
        const params = new URLSearchParams(location.search);
        const workDetailType = (params.get('workDetailType') || '').toLowerCase();
        const itemType = params.get('itemType') || '';
        const siteLabel = this.getCurrentSiteLabel();
        const isWorkDetailRoute = pathname.includes('/ai-tool/work-detail/');
        const isImageRoute = pathname.includes('/ai-tool/image/');
        const isVideoRoute = pathname.includes('/ai-tool/video/');
        const isGenerateRoute = pathname.includes('/ai-tool/generate') || pathname.includes('/ai-tool/canvas');
        const imageType = workDetailType === 'image' || itemType === '9' || itemType === '109';
        const videoType = workDetailType.includes('video') || itemType === '53' || itemType === '210';

        if (isGenerateRoute) {
            const modal = document.querySelector('.lv-modal-wrapper');
            if (!modal) return { supported: false, mediaType: null, label: `${siteLabel} generate (no modal)` };
            const hasVideo = !!modal.querySelector('video');
            return { supported: true, mediaType: hasVideo ? 'video' : 'image', label: `${siteLabel} generate modal`, isGeneratePage: true };
        }

        if (!isWorkDetailRoute && !isImageRoute && !isVideoRoute && !workDetailType) {
            return { supported: false, mediaType: null, label: `${siteLabel} not a detail page` };
        }

        if (isImageRoute || (isWorkDetailRoute && imageType)) {
            return { supported: true, mediaType: 'image', label: `${siteLabel} image detail` };
        }

        if (isVideoRoute || (isWorkDetailRoute && videoType)) {
            return { supported: true, mediaType: 'video', label: `${siteLabel} video detail` };
        }

        return { supported: true, mediaType: null, label: `${siteLabel} detail page` };
    }

    getPublishedItemId(url = location.href) {
        try {
            const parsed = new URL(url, location.href);
            const pathname = parsed.pathname;
            const matchers = [
                /\/ai-tool\/(?:image|video)\/(\d+)/,
                /\/ai-tool\/work-detail\/(\d+)/,
                /\/detail\/(\d+)/,
                /\/i\/(\d+)/,
                /\/v\/(\d+)/,
                /\/item\/(\d+)/,
                /\/post\/(\d+)/
            ];

            for (const matcher of matchers) {
                const match = pathname.match(matcher);
                if (match?.[1]) return match[1];
            }

            const queryId = parsed.searchParams.get('item_id') || parsed.searchParams.get('id');
            return queryId && /^\d+$/.test(queryId) ? queryId : null;
        } catch {
            return null;
        }
    }

    getCurrentDetailCacheKey(strategy = this.getPageStrategy()) {
        if (!this.isJimengHost()) {
            return location.href;
        }
        const lock = this.getCurrentDetailLock(strategy);
        return lock?.cacheKey || location.href;
    }

    getCurrentDetailLock(strategy = this.getPageStrategy()) {
        if (!this.isJimengHost() || !strategy.supported) return null;

        const lock = {
            mediaType: strategy.mediaType || 'detail',
            itemId: String(this.getPublishedItemId() || ''),
            signatures: new Set(),
            mediaKey: '',
            identity: '',
            cacheKey: '',
            element: null
        };

        const addSignature = (value, type = strategy.mediaType) => {
            const url = this.normalizeUrl(value);
            if (!url) return;
            lock.signatures.add(url);
            if (type === 'video') {
                const groupKey = this.describeVideoUrl(url).groupKey;
                if (groupKey) lock.signatures.add(groupKey);
                if (!lock.mediaKey) lock.mediaKey = groupKey || url;
                return;
            }
            const assetKey = this.extractAssetKey(url);
            if (assetKey) lock.signatures.add(assetKey);
            if (!lock.mediaKey) lock.mediaKey = assetKey || url;
        };

        if (strategy.mediaType === 'video') {
            const video = this.getMainVideoElements()[0] || null;
            const source = this.getMainVideoSourceElements()[0] || null;
            lock.element = video;
            [
                video?.currentSrc,
                video?.src,
                video?.getAttribute('src'),
                source?.src,
                source?.getAttribute('src'),
                video?.poster,
                video?.getAttribute('poster')
            ].forEach((value) => addSignature(value, 'video'));
        } else {
            const image = this.getMainImageElements()[0] || null;
            lock.element = image;
            [
                image?.currentSrc,
                image?.src,
                image?.getAttribute('src'),
                image?.getAttribute('data-src'),
                image?.getAttribute('data-original'),
                image?.getAttribute('data-full'),
                ...this.parseSrcset(image?.srcset || '')
            ].forEach((value) => addSignature(value, 'image'));
        }

        lock.identity = lock.itemId ? `${lock.mediaType}:${lock.itemId}` : lock.mediaKey || '';
        lock.cacheKey = lock.identity || `${lock.mediaType}:${location.href}`;
        return lock;
    }

    getWorkDetailSignatures(workDetail, strategy = this.getPageStrategy()) {
        if (!workDetail || typeof workDetail !== 'object') return new Set();
        const signatures = new Set();
        const addImageSignature = (value) => {
            const url = this.normalizeUrl(value);
            if (!url) return;
            signatures.add(url);
            const assetKey = this.extractAssetKey(url);
            if (assetKey) signatures.add(assetKey);
        };
        const addVideoSignature = (value) => {
            const url = this.normalizeUrl(value);
            if (!url) return;
            signatures.add(url);
            const groupKey = this.describeVideoUrl(url).groupKey;
            if (groupKey) signatures.add(groupKey);
        };

        if (strategy.mediaType === 'video') {
            this.collectVideoCandidatesFromWorkDetail(workDetail).forEach((candidate) => addVideoSignature(candidate?.url));
        } else {
            [
                ...this.collectImageCandidatesFromWorkDetail(workDetail, 'largeImages', '', { strict: false, sourcePrefix: 'router' }),
                ...this.collectImageCandidatesFromWorkDetail(workDetail, 'coverUrlMap', '', { strict: false, sourcePrefix: 'router' }),
                ...this.collectImageCandidatesFromWorkDetail(workDetail, 'coverUrl', '', { strict: false, sourcePrefix: 'router' })
            ].forEach((candidate) => addImageSignature(candidate?.url));
        }

        return signatures;
    }

    hasMatchingDetailLockSignatures(signatures, strategy = this.getPageStrategy()) {
        if (!(signatures instanceof Set) || !signatures.size) return false;
        const lock = this.getCurrentDetailLock(strategy);
        if (!lock?.signatures?.size) return false;
        for (const signature of signatures) {
            if (lock.signatures.has(signature)) return true;
        }
        return false;
    }

    scanMedia() {
        this.syncPageState();
        const strategy = this.getPageStrategy();
        const isJimeng = this.isJimengHost();
        if (!strategy.supported) {
            this.mediaItems = [];
            this.hideFloatingButton();
            return;
        }

        const detailMediaKey = this.getCurrentDetailMediaKey(strategy);
        const currentDetailIdentity = this.getCurrentDetailIdentity(strategy);
        if (currentDetailIdentity && this.lastDetailIdentity && currentDetailIdentity !== this.lastDetailIdentity) {
            this.resetDetailDataState();
            this.detailDataHydrated = false;
            this.hideFloatingButton();
            this.lastDetailIdentity = currentDetailIdentity;
            this.lastDetailMediaKey = detailMediaKey;
            this.scheduleDetailHydration(80);
        } else if (detailMediaKey && this.lastDetailMediaKey && detailMediaKey !== this.lastDetailMediaKey && !currentDetailIdentity) {
            this.resetDetailDataState();
            this.detailDataHydrated = false;
            this.hideFloatingButton();
            this.lastDetailMediaKey = detailMediaKey;
            this.scheduleDetailHydration(80);
        } else if (detailMediaKey && !this.lastDetailMediaKey) {
            this.lastDetailIdentity = currentDetailIdentity || this.lastDetailIdentity;
            this.lastDetailMediaKey = detailMediaKey;
            this.scheduleDetailHydration(80);
        } else if (detailMediaKey && this.lastDetailMediaKey !== detailMediaKey) {
            this.lastDetailIdentity = currentDetailIdentity || this.lastDetailIdentity;
            this.lastDetailMediaKey = detailMediaKey;
        } else if (currentDetailIdentity && !this.lastDetailIdentity) {
            this.lastDetailIdentity = currentDetailIdentity;
        } else if (!isJimeng && strategy.mediaType === 'image' && !this.officialWorkDetailData && !this.hasMatchingRouterData(strategy, detailMediaKey, { strict: true })) {
            this.scheduleDetailHydration(80);
        } else if (!isJimeng && strategy.mediaType !== 'image' && !this.officialWorkDetailData && !this.hasMatchingRouterData(strategy, detailMediaKey)) {
            this.scheduleDetailHydration(80);
        } else if (!isJimeng && strategy.mediaType === 'image' && !this.officialWorkDetailData) {
            this.scheduleDetailHydration(80);
        }

        let items = [];
        if (strategy.isGeneratePage) {
            items = this.collectGenerateModalMedia(strategy);
        } else if (strategy.mediaType === 'video') {
            items = this.collectVideos();
        } else if (strategy.mediaType === 'image') {
            items = this.collectImages();
        } else {
            items = [...this.collectVideos(), ...this.collectImages()];
        }

        const seen = new Set();
        this.mediaItems = items.filter((item) => {
            if (!item?.url || seen.has(item.url)) return false;
            seen.add(item.url);
            return true;
        }).slice(0, 1);
        if (isJimeng && !strategy.isGeneratePage && (strategy.mediaType === 'image' || strategy.mediaType === 'video')) {
            if (!this.isReliableStructuredSource(this.mediaItems[0]?.source)) {
                this.scheduleDetailHydration(80);
            }
        }
        this.updateFloatingButton();
    }

    isReliableStructuredSource(source = '') {
        const value = String(source || '');
        if (!value) return false;
        return value.startsWith('router-')
            || value.startsWith('router-runtime-')
            || value.startsWith('html-router-')
            || value.startsWith('bridge-')
            || value.startsWith('official-');
    }

    getCurrentDetailIdentity(strategy = this.getPageStrategy()) {
        if (this.isJimengHost()) {
            const lock = this.getCurrentDetailLock(strategy);
            return lock?.identity || '';
        }

        const publishedItemId = this.getPublishedItemId();
        if (publishedItemId) {
            return `${strategy.mediaType || 'detail'}:${publishedItemId}`;
        }

        if (strategy.mediaType === 'image') {
            const image = this.getMainImageElements()[0] || null;
            const url = this.normalizeUrl(image?.currentSrc || image?.src || image?.getAttribute('src'));
            return this.extractAssetKey(url) || url || '';
        }

        if (strategy.mediaType === 'video') {
            const video = this.getMainVideoElements()[0] || null;
            const source = this.getMainVideoSourceElements()[0] || null;
            const url = this.normalizeUrl(video?.currentSrc || video?.src || video?.getAttribute('src') || source?.src || source?.getAttribute('src'));
            return url ? (this.describeVideoUrl(url).groupKey || url) : '';
        }

        return '';
    }

    getCurrentDetailMediaKey(strategy = this.getPageStrategy()) {
        if (this.isJimengHost()) {
            const lock = this.getCurrentDetailLock(strategy);
            return lock?.mediaKey || '';
        }

        if (strategy.mediaType === 'image') {
            const image = this.getMainImageElements()[0] || null;
            const url = this.normalizeUrl(image?.currentSrc || image?.src || image?.getAttribute('src'));
            return this.extractAssetKey(url) || url || '';
        }

        if (strategy.mediaType === 'video') {
            const video = this.getMainVideoElements()[0] || null;
            const source = this.getMainVideoSourceElements()[0] || null;
            const url = this.normalizeUrl(video?.currentSrc || video?.src || video?.getAttribute('src') || source?.src || source?.getAttribute('src'));
            return url ? (this.describeVideoUrl(url).groupKey || url) : '';
        }

        return '';
    }

    hasMatchingRouterData(strategy, detailMediaKey = this.getCurrentDetailMediaKey(strategy), { strict = false } = {}) {
        if (this.isJimengHost()) {
            if (strategy.mediaType === 'image') {
                const candidates = this.collectStructuredWorkDetailEntries(strategy).flatMap(({ workDetail, sourcePrefix }) => ([
                    ...this.collectImageCandidatesFromWorkDetail(workDetail, 'largeImages', '', { strict: false, sourcePrefix }),
                    ...this.collectImageCandidatesFromWorkDetail(workDetail, 'coverUrlMap', '', { strict: false, sourcePrefix }),
                    ...this.collectImageCandidatesFromWorkDetail(workDetail, 'coverUrl', '', { strict: false, sourcePrefix })
                ]));
                return candidates.some((candidate) => this.isValidMediaUrl(this.normalizeUrl(candidate?.url), 'image'));
            }
            if (strategy.mediaType === 'video') {
                const candidates = this.collectStructuredWorkDetailEntries(strategy)
                    .flatMap(({ workDetail, sourcePrefix }) => this.collectVideoCandidatesFromWorkDetail(workDetail, { sourcePrefix }));
                return candidates.some((candidate) => this.isValidMediaUrl(this.normalizeUrl(candidate?.url), 'video'));
            }
            return Boolean(this.readRouterDataPayload());
        }
        if (!detailMediaKey) return false;
        if (strategy.mediaType === 'image') {
            const candidates = [
                ...this.collectImageCandidatesForLevel('largeImages', detailMediaKey, { strictRouter: strict }),
                ...this.collectImageCandidatesForLevel('coverUrlMap', detailMediaKey, { strictRouter: strict }),
                ...this.collectImageCandidatesForLevel('coverUrl', detailMediaKey, { strictRouter: strict })
            ];
            return candidates.some((candidate) => {
                const url = this.normalizeUrl(candidate?.url);
                return url && (this.extractAssetKey(url) || url) === detailMediaKey;
            }) || candidates.length > 0;
        }

        if (strategy.mediaType === 'video') {
            const candidates = this.collectVideoCandidatesFromRouterData();
            return candidates.some((candidate) => {
                const url = this.normalizeUrl(candidate?.url);
                if (!url) return false;
                const key = this.describeVideoUrl(url).groupKey || url;
                return key === detailMediaKey;
            });
        }

        return false;
    }

    collectGenerateModalMedia(strategy) {
        const modal = document.querySelector('.lv-modal-wrapper');
        if (!modal) return [];
        if (strategy.mediaType === 'video') {
            const video = modal.querySelector('video');
            const url = this.normalizeUrl(video?.currentSrc || video?.src || '');
            return url ? [this.createItem('video', url, 1, 'img-currentSrc')] : [];
        }
        const img = modal.querySelector('.lv-modal-content img') || modal.querySelector('img');
        const url = this.normalizeUrl(img?.currentSrc || img?.src || '');
        return url ? [this.createItem('image', url, 1, 'img-currentSrc')] : [];
    }

    collectVideos() {
        const routerCandidates = this.collectVideoCandidatesFromRouterData();
        const rawTextCandidates = this.extractVideoCandidatesFromRawText();
        const selected = this.pickFirstVideoCandidate([
            ...routerCandidates,
            ...rawTextCandidates,
            ...this.collectVideoCandidatesFromDom()
        ]);
        return selected ? [this.createItem('video', selected.url, 1, selected.source)] : [];
    }

    collectImages() {
        const image = this.getMainImageElements()[0] || null;
        const previewUrl = this.normalizeUrl(image?.currentSrc || image?.src || image?.getAttribute('src'));
        const assetKey = this.extractAssetKey(previewUrl);
        const isJimeng = this.isJimengHost();
        const routerStrict = !this.officialWorkDetailData && !isJimeng;
        const structuredEntries = isJimeng ? this.collectStructuredWorkDetailEntries() : [];
        const collectJimengStructuredLevel = (level) => {
            if (!structuredEntries.length) return [];
            const candidates = [];
            structuredEntries.forEach(({ workDetail, sourcePrefix }) => {
                candidates.push(...this.collectImageCandidatesFromWorkDetail(workDetail, level, '', {
                    strict: false,
                    sourcePrefix
                }));
            });
            return candidates;
        };
        const candidatePool = isJimeng
            ? [
                ...this.extractImageCandidatesFromRawText('originalImage'),
                ...collectJimengStructuredLevel('coverUrlMap'),
                ...this.extractImageCandidatesFromRawText('coverUrlMap'),
                ...collectJimengStructuredLevel('coverUrl'),
                ...this.extractImageCandidatesFromRawText('coverUrl'),
                ...collectJimengStructuredLevel('largeImages'),
                ...this.extractImageCandidatesFromRawText('largeImages'),
                ...this.collectImageCandidatesFromDom(image)
            ]
            : [
                ...this.extractDreaminaOriginalImage(),
                ...this.collectImageCandidatesForLevel('largeImages', assetKey, { strictRouter: routerStrict }),
                ...this.collectImageCandidatesForLevel('coverUrlMap', assetKey, { strictRouter: routerStrict }),
                ...this.collectImageCandidatesForLevel('coverUrl', assetKey, { strictRouter: routerStrict }),
                ...this.collectImageCandidatesFromDom(image)
            ];

        const normalized = this.normalizeImageCandidates(candidatePool);
        const selected = normalized[0] ? { url: normalized[0].url, source: normalized[0].source } : null;
        if (!selected) return [];

        const extraImageCandidates = this.buildImageDownloadProbeCandidatesFromNormalized(normalized, selected.url);
        return [this.createItem('image', selected.url, 1, selected.source, { extraImageCandidates })];
    }

    collectVideoCandidatesFromDom() {
        const candidates = [];
        const video = this.getMainVideoElements()[0] || null;
        const source = this.getMainVideoSourceElements()[0] || null;

        candidates.push({ url: video?.currentSrc, source: 'video-currentSrc' });
        candidates.push({ url: video?.src, source: 'video-src' });
        candidates.push({ url: video?.getAttribute('src'), source: 'video-attr' });
        candidates.push({ url: source?.src, source: 'source-src' });
        candidates.push({ url: source?.getAttribute('src'), source: 'source-attr' });

        return candidates;
    }

    pickFirstVideoCandidate(candidates) {
        const seen = new Set();
        for (const candidate of candidates) {
            const url = this.normalizeUrl(candidate?.url);
            if (!url || seen.has(url)) continue;
            seen.add(url);
            if (!this.isValidMediaUrl(url, 'video')) continue;
            return { url, source: candidate.source };
        }
        return null;
    }

    collectImageCandidatesFromDom(img) {
        if (!img) return [];
        const candidates = [];

        candidates.push({ url: img.currentSrc, source: 'img-currentSrc' });
        this.parseSrcset(img.srcset).forEach((value) => candidates.push({ url: value, source: 'img-srcset' }));
        candidates.push({ url: img.src, source: 'img-src' });
        candidates.push({ url: img.getAttribute('src'), source: 'img-attr' });
        candidates.push({ url: img.getAttribute('data-src'), source: 'img-data-src' });
        candidates.push({ url: img.getAttribute('data-original'), source: 'img-data-original' });
        candidates.push({ url: img.getAttribute('data-full'), source: 'img-data-full' });

        return candidates;
    }

    normalizeImageCandidates(candidates) {
        const seen = new Set();
        const normalized = [];
        candidates.forEach((candidate) => {
            const url = this.normalizeUrl(candidate?.url);
            if (!url || seen.has(url)) return;
            if (!this.isValidMediaUrl(url, 'image')) return;
            seen.add(url);
            normalized.push({
                url,
                source: candidate.source,
                sourcePriority: this.getImageSourcePriority(candidate.source),
                ...this.describeImageUrl(url)
            });
        });
        normalized.sort((a, b) => this.compareImages(a, b));
        return normalized;
    }

    buildImageDownloadProbeCandidatesFromNormalized(normalized, selectedUrl = '') {
        if (!normalized.length) return [];
        const selected = this.normalizeUrl(selectedUrl);
        const primary = [];
        const rest = [];

        normalized.forEach((item) => {
            const entry = { url: item.url, source: item.source };
            if (selected && item.url === selected) {
                primary.push(entry);
                return;
            }
            rest.push(entry);
        });

        const maxCandidates = this.isDreaminaHost() && this.officialWorkDetailData ? 2 : 6;
        return [...primary, ...rest].slice(0, maxCandidates);
    }

    collectImageCandidatesForLevel(level, assetKey = '', { strictRouter = false } = {}) {
        const candidates = [];

        if (this.officialWorkDetailData) {
            candidates.push(...this.collectImageCandidatesFromWorkDetail(this.officialWorkDetailData, level, assetKey, {
                strict: false,
                sourcePrefix: 'official'
            }));
        }

        const routerPayload = this.readRouterDataPayload();
        const routerWorkDetail = this.extractWorkDetailFromPayload(routerPayload);
        if (routerWorkDetail) {
            candidates.push(...this.collectImageCandidatesFromWorkDetail(routerWorkDetail, level, assetKey, {
                strict: strictRouter,
                sourcePrefix: 'router'
            }));
        }

        return candidates;
    }

    collectImageCandidatesFromWorkDetail(workDetail, level, assetKey = '', { strict = false, sourcePrefix = 'router' } = {}) {
        if (!workDetail) return [];

        const imageInfo = workDetail.image
            || workDetail.effectImage
            || workDetail.item?.image
            || workDetail.item?.effectImage
            || workDetail.value?.image
            || workDetail.value?.effectImage
            || workDetail.value?.item?.image
            || workDetail.value?.item?.effectImage
            || null;
        const commonAttr = workDetail.commonAttr
            || workDetail.common_attr
            || workDetail.item?.commonAttr
            || workDetail.item?.common_attr
            || workDetail.value?.commonAttr
            || workDetail.value?.common_attr
            || workDetail.value?.item?.commonAttr
            || workDetail.value?.item?.common_attr
            || null;
        const candidates = [];

        if (level === 'largeImages') {
            const largeImages = imageInfo?.largeImages || imageInfo?.large_images || [];
            if (Array.isArray(largeImages)) {
                largeImages.forEach((item) => {
                    if (item?.imageUrl) {
                        candidates.push({ url: item.imageUrl, source: `${sourcePrefix}-largeImages` });
                    } else if (item?.image_url) {
                        candidates.push({ url: item.image_url, source: `${sourcePrefix}-largeImages` });
                    }
                });
            }
        }

        if (level === 'coverUrlMap') {
            const coverUrlMap = commonAttr?.coverUrlMap || commonAttr?.cover_url_map || null;
            if (coverUrlMap && typeof coverUrlMap === 'object') {
                Object.entries(coverUrlMap)
                    .sort((a, b) => {
                        const sa = Number(a[0]) === 0 ? Infinity : Number(a[0] || 0);
                        const sb = Number(b[0]) === 0 ? Infinity : Number(b[0] || 0);
                        return sb - sa;
                    })
                    .forEach(([size, url]) => {
                        if (typeof url === 'string') {
                            candidates.push({ url, source: `${sourcePrefix}-coverUrlMap-${size}` });
                        }
                    });
            }
        }

        if (level === 'coverUrl') {
            const coverUrl = commonAttr?.coverUrl || commonAttr?.cover_url || null;
            if (typeof coverUrl === 'string') {
                candidates.push({ url: coverUrl, source: `${sourcePrefix}-coverUrl` });
            }
        }

        return this.filterImageCandidatesByAsset(candidates, assetKey, { strict });
    }

    extractWorkDetailFromPayload(payload) {
        if (!payload || typeof payload !== 'object') return null;

        const workDetail = payload?.bridgedWorkDetail
            || payload?.loaderData?.['ai-tool/work-detail/(id$)/page']?.workDetail?.value
            || payload?.loaderData?.['ai-tool/work-detail/(id$)/page']?.workDetail
            || payload?.loaderData?.['ai-tool/image/(id$)/page']?.workDetail?.value
            || payload?.loaderData?.['ai-tool/image/(id$)/page']?.workDetail
            || payload?.loaderData?.['ai-tool/video/(id$)/page']?.workDetail?.value
            || payload?.loaderData?.['ai-tool/video/(id$)/page']?.workDetail
            || this.findWorkDetailDeep(payload)
            || null;

        return workDetail;
    }

    filterImageCandidatesByAsset(candidates, assetKey, { strict = false } = {}) {
        if (!assetKey) return candidates;
        const filtered = candidates.filter((candidate) => {
            const url = this.normalizeUrl(candidate?.url);
            return url && this.extractAssetKey(url) === assetKey;
        });
        if (filtered.length) return filtered;
        return strict ? [] : candidates;
    }

    collectVideoCandidatesFromRouterData() {
        if (this.isJimengHost()) {
            return this.collectStructuredWorkDetailEntries().flatMap(({ workDetail, sourcePrefix }) => this.collectVideoCandidatesFromWorkDetail(workDetail, { sourcePrefix }));
        }

        const workDetail = this.readWorkDetailPayload();
        return this.collectVideoCandidatesFromWorkDetail(workDetail);
    }

    collectVideoCandidatesFromWorkDetail(workDetail, { sourcePrefix = 'router' } = {}) {
        if (!workDetail) return [];

        const videoInfo = workDetail.video
            || workDetail.videoInfo
            || workDetail.video_info
            || workDetail.item?.video
            || workDetail.item?.videoInfo
            || workDetail.item?.video_info
            || workDetail.value?.video
            || workDetail.value?.videoInfo
            || workDetail.value?.video_info
            || workDetail.value?.item?.video
            || workDetail.value?.item?.videoInfo
            || workDetail.value?.item?.video_info
            || null;
        const commonAttr = workDetail.commonAttr
            || workDetail.common_attr
            || workDetail.item?.commonAttr
            || workDetail.item?.common_attr
            || workDetail.value?.commonAttr
            || workDetail.value?.common_attr
            || workDetail.value?.item?.commonAttr
            || workDetail.value?.item?.common_attr
            || null;

        const seen = new Set();
        const originCandidates = [];
        const transcodedCandidates = [];
        const playAddrCandidates = [];
        const itemUrlCandidates = [];
        const fallbackCandidates = [];

        const add = (bucket, value, source) => {
            const url = this.normalizeUrl(value);
            if (!url || seen.has(url)) return;
            if (!this.isValidMediaUrl(url, 'video')) return;
            seen.add(url);
            bucket.push({
                url,
                source,
                sourcePriority: this.getVideoSourcePriority(source),
                ...this.describeVideoUrl(url)
            });
        };

        const originVideo = videoInfo?.originVideo || videoInfo?.origin_video || null;
        add(originCandidates, originVideo?.videoUrl, `${sourcePrefix}-originVideo`);
        add(originCandidates, originVideo?.video_url, `${sourcePrefix}-originVideo`);
        add(originCandidates, videoInfo?.originVideoUrl, `${sourcePrefix}-originVideo`);
        add(originCandidates, videoInfo?.origin_video_url, `${sourcePrefix}-originVideo`);

        const transcoded = videoInfo?.transcodedVideo || videoInfo?.transcoded_video || null;
        if (transcoded && typeof transcoded === 'object') {
            Object.entries(transcoded).forEach(([key, item]) => {
                add(transcodedCandidates, item?.videoUrl || item?.video_url, `${sourcePrefix}-transcoded-${key}`);
                add(transcodedCandidates, item?.url, `${sourcePrefix}-transcoded-${key}`);
            });
        }
        transcodedCandidates.sort((a, b) => this.compareVideos(a, b));

        const playAddr = videoInfo?.playAddr || videoInfo?.play_addr || null;
        const urlList = playAddr?.urlList || playAddr?.url_list || playAddr?.urls || [];
        if (Array.isArray(urlList)) {
            urlList.forEach((url, index) => add(playAddrCandidates, url, `${sourcePrefix}-playAddr-${index}`));
        }
        add(playAddrCandidates, playAddr?.url, `${sourcePrefix}-playAddr-main`);
        add(playAddrCandidates, playAddr?.mainUrl, `${sourcePrefix}-playAddr-main`);

        const itemUrls = commonAttr?.itemUrls || commonAttr?.item_urls || workDetail.itemUrls || workDetail.item_urls || workDetail.item?.itemUrls || workDetail.item?.item_urls || workDetail.value?.itemUrls || workDetail.value?.item_urls || workDetail.value?.item?.itemUrls || workDetail.value?.item?.item_urls || [];
        if (Array.isArray(itemUrls)) {
            itemUrls.forEach((url, index) => add(itemUrlCandidates, url, `${sourcePrefix}-itemUrls-${index}`));
        }

        add(fallbackCandidates, videoInfo?.videoUrl, `${sourcePrefix}-videoUrl`);
        add(fallbackCandidates, videoInfo?.video_url, `${sourcePrefix}-videoUrl`);
        add(fallbackCandidates, videoInfo?.url, `${sourcePrefix}-videoUrl`);

        return [
            ...originCandidates,
            ...transcodedCandidates,
            ...playAddrCandidates,
            ...itemUrlCandidates,
            ...fallbackCandidates
        ].map(({ url, source }) => ({ url, source }));
    }

    getStructuredRouterPayloadEntries(strategy = this.getPageStrategy()) {
        const entries = [];
        const pushEntry = (payload, sourcePrefix, key) => {
            if (!payload || typeof payload !== 'object') return;
            if (!this.hasPayloadMatchingCurrentDetail(payload, strategy)) return;
            const cacheKey = `${sourcePrefix}:${key}`;
            if (entries.some((entry) => entry.cacheKey === cacheKey)) return;
            entries.push({ payload, sourcePrefix, cacheKey });
        };

        const itemId = String(this.getPublishedItemId() || '');
        const documentPayload = this.getCurrentDocumentRouterPayload(strategy);
        pushEntry(documentPayload, 'router', itemId || 'document');

        if (window._ROUTER_DATA && typeof window._ROUTER_DATA === 'object') {
            pushEntry(window._ROUTER_DATA, 'router-runtime', itemId || 'window');
        }

        const bridgeMatch = this.getCurrentBridgeMatchState(this.bridgedWorkDetailMeta, strategy);
        if (this.bridgedWorkDetailData && bridgeMatch.matched) {
            pushEntry({ bridgedWorkDetail: this.bridgedWorkDetailData }, this.bridgedWorkDetailMeta?.sourceKind || 'bridge-router', itemId || 'bridge');
        }

        return entries;
    }

    collectStructuredWorkDetailEntries(strategy = this.getPageStrategy()) {
        const entries = [];
        const pushWorkDetail = (workDetail, sourcePrefix, key) => {
            if (!workDetail || typeof workDetail !== 'object') return;
            const cacheKey = `${sourcePrefix}:${key}`;
            if (entries.some((entry) => entry.cacheKey === cacheKey)) return;
            entries.push({ workDetail, sourcePrefix, cacheKey });
        };

        if (!this.isJimengHost()) {
            if (this.officialWorkDetailData) {
                pushWorkDetail(this.officialWorkDetailData, 'official', this.officialWorkDetailKey || 'official');
            }
            const workDetail = this.readWorkDetailPayload();
            if (workDetail) {
                pushWorkDetail(workDetail, 'router', this.getCurrentDetailCacheKey(strategy));
            }
            return entries;
        }

        this.getStructuredRouterPayloadEntries(strategy).forEach(({ payload, sourcePrefix, cacheKey }) => {
            const workDetail = this.extractWorkDetailFromPayload(payload);
            if (workDetail) {
                pushWorkDetail(workDetail, sourcePrefix, cacheKey);
            }
        });

        return entries;
    }

    readWorkDetailPayload() {
        if (this.officialWorkDetailData) {
            return this.officialWorkDetailData;
        }

        const payload = this.readRouterDataPayload();
        const direct = payload?.bridgedWorkDetail
            || payload?.loaderData?.['ai-tool/work-detail/(id$)/page']?.workDetail?.value
            || payload?.loaderData?.['ai-tool/work-detail/(id$)/page']?.workDetail
            || payload?.loaderData?.['ai-tool/image/(id$)/page']?.workDetail?.value
            || payload?.loaderData?.['ai-tool/image/(id$)/page']?.workDetail
            || payload?.loaderData?.['ai-tool/video/(id$)/page']?.workDetail?.value
            || payload?.loaderData?.['ai-tool/video/(id$)/page']?.workDetail
            || null;
        if (direct) return direct;

        return this.findWorkDetailDeep(payload);
    }

    findWorkDetailDeep(payload) {
        if (!payload || typeof payload !== 'object') return null;

        const targetId = this.getPublishedItemId();
        const seen = new Set();
        const stack = [payload];
        let fallback = null;

        while (stack.length) {
            const current = stack.pop();
            if (!current || typeof current !== 'object' || seen.has(current)) continue;
            seen.add(current);

            const candidate = current?.workDetail?.value || current?.workDetail || null;
            if (candidate && typeof candidate === 'object') {
                if (this.isMatchingWorkDetail(candidate, targetId)) return candidate;
                if (!fallback) fallback = candidate;
            }

            if (this.looksLikeWorkDetail(current)) {
                if (this.isMatchingWorkDetail(current, targetId)) return current;
                if (!fallback) fallback = current;
            }

            if (Array.isArray(current)) {
                for (let i = current.length - 1; i >= 0; i -= 1) {
                    stack.push(current[i]);
                }
                continue;
            }

            Object.values(current).forEach((value) => {
                if (value && typeof value === 'object') stack.push(value);
            });
        }

        return fallback;
    }

    looksLikeWorkDetail(value) {
        if (!value || typeof value !== 'object') return false;
        return Boolean(
            value.image
            || value.effectImage
            || value.video
            || value.videoInfo
            || value.video_info
            || value.commonAttr
            || value.common_attr
            || value.item?.image
            || value.item?.effectImage
            || value.item?.video
            || value.item?.videoInfo
            || value.item?.video_info
            || value.item?.commonAttr
            || value.item?.common_attr
        );
    }

    isMatchingWorkDetail(workDetail, targetId = this.getPublishedItemId()) {
        if (!workDetail || typeof workDetail !== 'object') return false;
        if (!targetId) return this.looksLikeWorkDetail(workDetail);

        const ids = this.getWorkDetailIdCandidates(workDetail);

        return ids.includes(String(targetId));
    }

    isWorkDetailMatchingCurrentDetail(workDetail, strategy = this.getPageStrategy()) {
        if (!workDetail || typeof workDetail !== 'object') return false;

        const currentItemId = String(this.getPublishedItemId() || '');
        if (currentItemId && this.isMatchingWorkDetail(workDetail, currentItemId)) return true;

        if (this.isJimengHost()) {
            const lock = this.getCurrentDetailLock(strategy);
            if (!lock) return this.looksLikeWorkDetail(workDetail);

            const workDetailId = this.getWorkDetailIdCandidates(workDetail)[0] || '';
            const workDetailIdentity = workDetailId
                ? `${strategy.mediaType || 'detail'}:${workDetailId}`
                : '';
            if (lock.identity && workDetailIdentity && lock.identity === workDetailIdentity) return true;

            const workDetailSignatures = this.getWorkDetailSignatures(workDetail, strategy);
            if (this.hasMatchingDetailLockSignatures(workDetailSignatures, strategy)) return true;

            return !lock.itemId && !lock.signatures.size && this.looksLikeWorkDetail(workDetail);
        }

        const currentDetailIdentity = this.getCurrentDetailIdentity(strategy);
        const workDetailId = this.getWorkDetailIdCandidates(workDetail)[0] || '';
        const workDetailIdentity = workDetailId
            ? `${strategy.mediaType || 'detail'}:${workDetailId}`
            : '';
        if (currentDetailIdentity && workDetailIdentity && currentDetailIdentity === workDetailIdentity) return true;

        const currentDetailMediaKey = this.getCurrentDetailMediaKey(strategy);
        const workDetailMediaKey = this.getWorkDetailPrimaryMediaKey(workDetail, strategy);
        if (currentDetailMediaKey && workDetailMediaKey && currentDetailMediaKey === workDetailMediaKey) return true;

        return !currentItemId && !currentDetailIdentity && !currentDetailMediaKey && this.looksLikeWorkDetail(workDetail);
    }

    hasPayloadMatchingCurrentDetail(payload, strategy = this.getPageStrategy()) {
        const workDetail = this.extractWorkDetailFromPayload(payload);
        return this.isWorkDetailMatchingCurrentDetail(workDetail, strategy);
    }

    extractCurrentDocumentRouterPayload(strategy = this.getPageStrategy()) {
        const scripts = Array.from(document.scripts || []);
        for (const script of scripts) {
            const text = script.textContent || '';
            if (!text.includes('window._ROUTER_DATA')) continue;
            const payloads = this.extractAllRouterDataFromText(text);
            const matched = payloads.find((payload) => this.hasPayloadMatchingCurrentDetail(payload, strategy));
            if (matched) return matched;
        }

        const html = document.documentElement?.innerHTML || '';
        if (!html.includes('window._ROUTER_DATA')) return null;
        const payloads = this.extractAllRouterDataFromText(html);
        return payloads.find((payload) => this.hasPayloadMatchingCurrentDetail(payload, strategy)) || null;
    }

    getCurrentDocumentRouterPayload(strategy = this.getPageStrategy(), { force = false } = {}) {
        const cacheKey = this.isJimengHost()
            ? String(this.getPublishedItemId() || location.href)
            : this.getCurrentDetailCacheKey(strategy);
        if (!force && this.documentRouterPayload && this.documentRouterPayloadKey === cacheKey) {
            if (this.hasPayloadMatchingCurrentDetail(this.documentRouterPayload, strategy)) {
                return this.documentRouterPayload;
            }
        }

        const payload = this.extractCurrentDocumentRouterPayload(strategy);
        this.documentRouterPayload = payload;
        this.documentRouterPayloadKey = cacheKey;

        if (!payload) return null;
        return this.hasPayloadMatchingCurrentDetail(payload, strategy) ? payload : null;
    }

    readRouterDataPayload() {
        const strategy = this.getPageStrategy();
        const entries = this.getStructuredRouterPayloadEntries(strategy);
        const first = entries[0] || null;

        if (first) {
            this.debug('read-router-payload', { source: first.sourcePrefix });
            return first.payload;
        }

        this.debug('read-router-payload', { source: 'none' });
        return null;
    }

    async refreshActiveDetailData({ force = false } = {}) {
        const strategy = this.getPageStrategy();
        const cacheKey = this.isJimengHost()
            ? String(this.getPublishedItemId() || location.href)
            : this.getCurrentDetailCacheKey(strategy);
        if (!strategy.supported) {
            this.documentRouterPayload = null;
            this.documentRouterPayloadKey = '';
            this.officialWorkDetailData = null;
            this.officialWorkDetailKey = '';
            return null;
        }

        const documentPayload = this.getCurrentDocumentRouterPayload(strategy, { force });
        if (documentPayload && !(this.isDreaminaHost() && strategy.mediaType === 'image' && !this.officialWorkDetailData)) {
            this.debug('refresh-active-detail-data-document-hit', { source: 'document-router', cacheKey });
            return this.officialWorkDetailData || documentPayload;
        }

        const bridgeMatch = this.getCurrentBridgeMatchState(this.bridgedWorkDetailMeta, strategy);
        if (!force && bridgeMatch.matched && this.bridgedWorkDetailData) {
            this.debug('refresh-active-detail-data-short-circuit', {
                source: this.bridgedWorkDetailMeta?.sourceKind || 'bridge-router',
                reason: bridgeMatch.reason
            });
            return this.bridgedWorkDetailData;
        }
        if (this.bridgedWorkDetailData && !bridgeMatch.matched) {
            this.invalidateBridgedWorkDetail(bridgeMatch.reason || 'refresh-mismatch');
        }

        try {
            if (this.isDreaminaHost()) {
                try {
                    await this.withTimeout(this.fetchOfficialWorkDetail(cacheKey), 3000);
                } catch (error) {
                    this.debug('official-api-timeout', { error: error?.message });
                }
                if (this.officialWorkDetailData) {
                    this.debug('refresh-active-detail-data-official-hit', { source: 'official-api', cacheKey });
                    return this.officialWorkDetailData;
                }
            }

            const currentDocumentPayload = this.getCurrentDocumentRouterPayload(strategy, { force: true });
            if (currentDocumentPayload) {
                this.debug('refresh-active-detail-data-document-hit', { source: 'document-router', cacheKey });
                return this.officialWorkDetailData || currentDocumentPayload;
            }

            const matchedBridge = this.getCurrentBridgeMatchState(this.bridgedWorkDetailMeta, strategy);
            if (matchedBridge.matched && this.bridgedWorkDetailData) {
                this.debug('refresh-active-detail-data-bridge-hit', {
                    source: this.bridgedWorkDetailMeta?.sourceKind || 'bridge-router',
                    reason: matchedBridge.reason
                });
                return this.bridgedWorkDetailData;
            }
            if (this.bridgedWorkDetailData && !matchedBridge.matched) {
                this.invalidateBridgedWorkDetail(matchedBridge.reason || 'refresh-bridge-mismatch');
            }

            if (this.isJimengHost()) {
                const response = await fetch(location.href, {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: { 'Accept': 'text/html,application/xhtml+xml' }
                });
                if (response.ok) {
                    const html = await response.text();
                    const payloads = this.extractAllRouterDataFromText(html);
                    const payload = payloads.find((item) => this.hasPayloadMatchingCurrentDetail(item, strategy)) || null;
                    if (payload) {
                        this.debug('refresh-active-detail-data-html-hit', { source: 'html-router', cacheKey });
                        return this.officialWorkDetailData || payload;
                    }
                }
            }
        } catch {}
        return this.officialWorkDetailData || null;
    }

    withTimeout(promise, timeoutMs) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
        ]);
    }

    async fetchOfficialWorkDetail(cacheKey) {
        const itemId = this.getPublishedItemId(cacheKey);
        if (!itemId) return null;
        if (this.officialWorkDetailData && this.officialWorkDetailKey === itemId) {
            return this.officialWorkDetailData;
        }
        if (this.officialWorkDetailPromise) {
            return this.officialWorkDetailPromise;
        }

        this.officialWorkDetailPromise = (async () => {
            const endpoints = [
                {
                    url: 'https://mweb-api-sg.capcut.com/mweb/v1/get_item_info?aid=513641&web_version=7.5.0&da_version=3.3.7&aigc_features=app_lip_sync',
                    origin: 'https://dreamina.capcut.com',
                    referer: 'https://dreamina.capcut.com/'
                }
            ];

            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(endpoint.url, {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'accept': 'application/json, text/plain, */*',
                            'content-type': 'application/json',
                            'origin': endpoint.origin,
                            'referer': endpoint.referer
                        },
                        body: JSON.stringify({ published_item_id: itemId })
                    });
                    if (!response.ok) continue;

                    const payload = await response.json();
                    if (String(payload?.ret) !== '0' || !payload?.data) continue;

                    this.officialWorkDetailData = payload.data;
                    this.officialWorkDetailKey = itemId;
                    return payload.data;
                } catch {}
            }

            return null;
        })();

        try {
            return await this.officialWorkDetailPromise;
        } finally {
            this.officialWorkDetailPromise = null;
        }
    }

    extractAllRouterDataFromText(text) {
        if (!text || !text.includes('window._ROUTER_DATA')) return [];

        const marker = 'window._ROUTER_DATA';
        const payloads = [];
        let searchIndex = 0;

        while (searchIndex < text.length) {
            const markerIndex = text.indexOf(marker, searchIndex);
            if (markerIndex < 0) break;

            const braceStart = text.indexOf('{', markerIndex);
            if (braceStart < 0) break;

            let depth = 0;
            let inString = false;
            let escaped = false;
            let endedAt = braceStart;

            for (let index = braceStart; index < text.length; index += 1) {
                const char = text[index];

                if (inString) {
                    if (escaped) {
                        escaped = false;
                        continue;
                    }
                    if (char === '\\') {
                        escaped = true;
                        continue;
                    }
                    if (char === '"') {
                        inString = false;
                    }
                    continue;
                }

                if (char === '"') {
                    inString = true;
                    continue;
                }
                if (char === '{') {
                    depth += 1;
                    continue;
                }
                if (char === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        endedAt = index + 1;
                        const jsonText = text.slice(braceStart, endedAt);
                        try {
                            payloads.push(JSON.parse(jsonText));
                        } catch {
                        }
                        break;
                    }
                }
            }

            searchIndex = Math.max(searchIndex + marker.length, endedAt);
        }

        return payloads;
    }

    compareImages(a, b) {
        if (a.tier !== b.tier) return b.tier - a.tier;
        if ((a.sourcePriority || 0) !== (b.sourcePriority || 0)) return (b.sourcePriority || 0) - (a.sourcePriority || 0);
        if (a.area !== b.area) return b.area - a.area;
        return b.url.length - a.url.length;
    }

    compareVideos(a, b) {
        if (a.sourcePriority !== b.sourcePriority) return b.sourcePriority - a.sourcePriority;
        if (a.heightRank !== b.heightRank) return b.heightRank - a.heightRank;
        if (a.bitrate !== b.bitrate) return b.bitrate - a.bitrate;
        if (a.ds !== b.ds) return b.ds - a.ds;
        if (a.bucketPriority !== b.bucketPriority) return b.bucketPriority - a.bucketPriority;
        return b.url.length - a.url.length;
    }

    describeImageUrl(url) {
        const assetKey = this.extractAssetKey(url);
        const lower = url.toLowerCase();
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const leaf = (parsed.pathname.split('/').pop() || '').toLowerCase();
        const variantPart = leaf.includes('~tplv-') ? leaf.split('~tplv-')[1] : '';
        const resizeMatch = variantPart.match(/aigc_resize:(\d{1,5}):(\d{1,5})/);
        const width = resizeMatch ? Number(resizeMatch[1]) : 0;
        const height = resizeMatch ? Number(resizeMatch[2]) : 0;
        const isOriginalImage = width === 0 && height === 0 && resizeMatch;
        const variantType = resizeMatch
            ? 'aigc_resize'
            : variantPart.includes('uname_busi_aigc_mark_new')
                ? 'aigc_mark_new'
                : variantPart.includes('aigc_busi_mark')
                    ? 'aigc_busi_mark'
                    : variantPart.split(':')[0] || 'unknown';
        const hostKind = host.includes('dreamina-safe-sign')
            ? 'safe-sign'
            : host.includes('dreamina-sign')
                ? 'sign'
                : 'other';
        const watermarkedLikely = hostKind === 'safe-sign'
            || variantType === 'aigc_mark_new'
            || variantType === 'aigc_busi_mark'
            || /(watermark|mark_new|aigc_mark|busi_mark)/.test(lower);

        let tier = 0;
        if (isOriginalImage) tier = 6;
        else if (hostKind === 'sign' && variantType === 'aigc_resize' && (width >= 2400 || height >= 2400)) tier = 5;
        else if (hostKind === 'sign' && variantType === 'aigc_resize') tier = 4;
        else if (hostKind === 'sign' && !watermarkedLikely) tier = 3;
        else if (!watermarkedLikely) tier = 2;
        else if (hostKind === 'safe-sign') tier = 0;
        else tier = 1;

        return {
            assetKey,
            hostKind,
            variantType,
            width,
            height,
            area: isOriginalImage ? Infinity : width * height,
            watermarkedLikely,
            tier
        };
    }

    describeVideoUrl(url) {
        const parsed = new URL(url);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const groupKey = segments.length >= 3 && segments[2] === 'video' && segments[1]
            ? `video:${segments[1]}`
            : `video:${parsed.pathname}`;
        const bitrate = Math.max(
            Number(parsed.searchParams.get('br') || 0),
            Number(parsed.searchParams.get('bt') || 0)
        );
        const ds = Number(parsed.searchParams.get('ds') || 0);
        const heightRank = Number(parsed.searchParams.get('height') || 0);
        const bucket = segments.find((segment) => segment.startsWith('tos-cn-')) || '';
        const bucketPriority = bucket === 'tos-cn-v-148450' ? 2 : bucket === 'tos-cn-ve-18544c800' ? 1 : 0;
        return { groupKey, bitrate, ds, heightRank, bucketPriority };
    }

    getImageSourcePriority(source) {
        if (!source || typeof source !== 'string') return 0;
        if (source.includes('-originalImage-')) return 70;
        if (/^official-/.test(source) && source.includes('-largeImages')) return 65;
        if (/^official-/.test(source) && source.includes('-coverUrlMap-')) {
            const size = Number((source.match(/-coverUrlMap-(\d+)/) || [])[1] || 0);
            const sizeBonus = Math.min(8, Math.floor(size / 512));
            return 58 + sizeBonus;
        }
        if (/^official-/.test(source) && source.endsWith('-coverUrl')) return 52;
        if (source.includes('-largeImages')) return 60;
        if (source.includes('-coverUrlMap-')) {
            const size = Number((source.match(/-coverUrlMap-(\d+)/) || [])[1] || 0);
            const sizeBonus = size === 0 ? 10 : Math.min(8, Math.floor(size / 512));
            return 55 + sizeBonus;
        }
        if (source.endsWith('-coverUrl')) return 50;
        if (source.startsWith('img-srcset')) return 40;
        if (source.startsWith('img-currentSrc')) return 35;
        if (source.startsWith('img-src')) return 30;
        if (source.startsWith('img-data-')) return 25;
        if (source.startsWith('observed')) return 10;
        return 5;
    }

    getVideoSourcePriority(source) {
        if (!source || typeof source !== 'string') return 0;
        if (source.includes('-originVideo')) return 100;

        const transcoded = source.match(/-transcoded-(.+)$/);
        if (transcoded) {
            const label = transcoded[1].toLowerCase();
            if (label.includes('2160')) return 90;
            if (label.includes('1440')) return 80;
            if (label.includes('1080')) return 70;
            if (label.includes('720')) return 60;
            if (label.includes('540')) return 50;
            if (label.includes('480')) return 40;
            if (label.includes('360')) return 30;
            return 35;
        }

        if (source.includes('-playAddr')) return 20;
        if (source.includes('-videoUrl')) return 18;
        if (source.includes('-deep')) return 17;
        if (source.includes('-itemUrls')) return 15;
        if (source.startsWith('video-currentSrc')) return 10;
        if (source.startsWith('video-src')) return 9;
        if (source.startsWith('source-src')) return 8;
        if (source.startsWith('observed')) return 5;
        return 0;
    }

    createItem(type, url, index, source, extras = null) {
        return {
            id: `${type}-${index}-${this.hash(url)}`,
            type,
            url,
            filename: this.buildFilename(type, url, index),
            source,
            ...(extras && typeof extras === 'object' ? extras : {})
        };
    }

    buildFilename(type, url, index) {
        const ext = this.guessExtension(url, type);
        const title = this.getWorkTitle();
        if (title) {
            const safe = title.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 30);
            return `${safe}.${ext}`;
        }
        const cleanUrl = url.split('#')[0].split('?')[0];
        const name = cleanUrl.split('/').pop() || `${type}-${index}`;
        const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const hasExtension = /\.[a-zA-Z0-9]{2,5}$/.test(safeName);
        if (hasExtension) return safeName;
        return `${safeName || `${type}-${index}`}.${ext}`;
    }

    guessExtension(url, type) {
        const clean = (url || '').split('?')[0].split('#')[0].toLowerCase();
        const m = clean.match(/\.(webp|jpg|jpeg|png|gif|mp4|mov|webm)(\b|$)/);
        if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
        return type === 'video' ? 'mp4' : 'webp';
    }

    getQualityLabel(source, url = '') {
        const s = String(source || '');
        if (s.includes('coverUrlMap-0') || (url || '').includes('aigc_resize_0_0') || (url || '').includes('aigc_resize:0:0')) return '原图';
        const urlSize = (url || '').match(/(?:aigc_resize|resize)[_:](\d{3,4})/i)?.[1]
            || (url || '').match(/[_-](\d{3,4})[_x]\d{3,4}/)?.[1];
        if (urlSize) return `${urlSize}px`;
        if (s.includes('4096')) return '4096px';
        if (s.includes('2400')) return '2400px';
        if (s.includes('largeImages')) return '高清原图';
        if (s.includes('originVideo')) return '原画视频';
        if (s.includes('2160')) return '4K 视频';
        if (s.includes('1080')) return '1080p 视频';
        if (s.includes('720')) return '720p 视频';
        return '标准画质';
    }

    getWorkTitle() {
        const selectors = [
            '[class*="prompt-value-text"]',
            '[class*="title-wrapper"]',
            '[class*="prompt-text"]',
            '[class*="promptText"]',
            '[class*="work-title"]',
            '[class*="workTitle"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            const text = el?.textContent?.trim();
            if (text && text.length > 1) return text.slice(0, 15);
        }
        return '';
    }

    parseSrcset(srcset) {
        if (!srcset) return [];
        return srcset
            .split(',')
            .map((part) => part.trim().split(/\s+/)[0])
            .filter(Boolean);
    }

    syncPageState() {
        if (this.lastPageUrl === location.href) return;
        const previousUrl = this.lastPageUrl;
        const nextUrl = location.href;
        if (this.maybeForceHardNavigation(nextUrl, previousUrl, 'sync-page-state')) {
            this.lastPageUrl = nextUrl;
            return;
        }
        this.lastPageUrl = location.href;
        this.invalidateBridgedWorkDetail('sync-page-state');
        this.resetDetailDataState();
        this.detailDataHydrated = false;
        this.hideFloatingButton();
        this.scheduleDetailHydration(120);
    }

    handlePageChange(url) {
        if (!url || url === this.lastPageUrl) return;
        const previousUrl = this.lastPageUrl;
        if (this.maybeForceHardNavigation(url, previousUrl, 'page-change')) {
            this.lastPageUrl = url;
            return;
        }
        this.lastPageUrl = url;
        this.invalidateBridgedWorkDetail('page-change');
        this.resetDetailDataState();
        this.detailDataHydrated = false;
        this.hideFloatingButton();
        this.scheduleScan(20);
        this.scheduleDetailHydration(120);
    }

    makeHardNavKey(url) {
        try {
            const parsed = new URL(url, location.href);
            parsed.hash = '';
            return `${HARD_NAV_SESSION_PREFIX}${parsed.toString()}`;
        } catch {
            return `${HARD_NAV_SESSION_PREFIX}${String(url || '')}`;
        }
    }

    maybeForceHardNavigation(nextUrl, previousUrl = this.lastPageUrl, reason = 'unknown') {
        return false;
    }

    isJimengDetailUrl(url) {
        if (!url || typeof url !== 'string') return false;
        try {
            const parsed = new URL(url, location.href);
            if (!parsed.hostname.includes('jimeng.jianying.com')) return false;
            const pathname = parsed.pathname.toLowerCase();
            if (pathname.includes('/ai-tool/work-detail/') || pathname.includes('/ai-tool/image/') || pathname.includes('/ai-tool/video/')) return true;
            const workDetailType = (parsed.searchParams.get('workDetailType') || '').toLowerCase();
            return workDetailType === 'image' || workDetailType.includes('video');
        } catch {
            return false;
        }
    }

    handleDocumentLoad(event) {
        const target = event?.target;
        if (!(target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLSourceElement)) return;
        const strategy = this.getPageStrategy();
        if (!strategy.supported) return;
        if (target instanceof HTMLImageElement && strategy.mediaType !== 'image') return;
        if ((target instanceof HTMLVideoElement || target instanceof HTMLSourceElement) && strategy.mediaType !== 'video') return;
        if (!this.hasDetailContainerAncestor(target) && !this.hasFixedOverlayAncestor(target)) return;
        this.detailDataHydrated = false;
        this.scheduleScan(20);
        this.scheduleDetailHydration(40);
    }

    getMainVideoElements() {
        const candidates = this.filterToDetailLayerMediaElements(
            Array.from(document.querySelectorAll('video')).filter((video) => this.isLikelyMainVideo(video))
        );
        return this.pickPrimaryMediaElements(candidates);
    }

    isLikelyDetailMediaElement(element) {
        if (!(element instanceof Element)) return false;
        let node = element;
        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
            const text = `${node.className || ''} ${node.id || ''} ${node.getAttribute?.('data-testid') || ''}`.toLowerCase();
            if (!text) continue;
            if (/(masonry|waterfall|feed|list|grid|card|gallery|recommend|related|explore|search|profile|avatar|comment|sidebar|aside)/.test(text)) {
                return false;
            }
            if (/(detail|dialog|drawer|modal|preview|viewer|swiper|carousel|overlay|lightbox)/.test(text)) {
                return true;
            }
        }
        return true;
    }

    getMainVideoSourceElements() {
        const mainVideos = new Set(this.getMainVideoElements());
        return Array.from(document.querySelectorAll('video source[src]')).filter((source) => {
            const owner = source.closest('video');
            return owner ? mainVideos.has(owner) : false;
        });
    }

    getMainImageElements() {
        const candidates = this.filterToDetailLayerMediaElements(
            Array.from(document.querySelectorAll('img')).filter((img) => this.isLikelyMainImage(img))
        );
        return this.pickPrimaryMediaElements(candidates);
    }

    filterToDetailLayerMediaElements(elements) {
        if (!Array.isArray(elements) || !elements.length) return [];
        const filtered = this.isJimengHost()
            ? elements.filter((element) => this.isLikelyDetailMediaElement(element))
            : elements;
        const detailLayerElements = filtered.filter((element) =>
            this.hasDetailContainerAncestor(element) || this.hasFixedOverlayAncestor(element)
        );
        return detailLayerElements.length ? detailLayerElements : filtered;
    }

    pickPrimaryMediaElements(elements) {
        if (!elements.length) return [];
        const visible = elements.filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        const pool = visible.length ? visible : elements;
        return [pool.sort((a, b) => this.compareMediaElementsByPriority(a, b))[0]];
    }

    compareMediaElementsByPriority(a, b) {
        const aOverlay = this.hasDetailContainerAncestor(a) ? 2 : this.hasFixedOverlayAncestor(a) ? 1 : 0;
        const bOverlay = this.hasDetailContainerAncestor(b) ? 2 : this.hasFixedOverlayAncestor(b) ? 1 : 0;
        if (aOverlay !== bOverlay) return bOverlay - aOverlay;

        if (this.isJimengHost()) {
            const aCenter = this.getViewportCenterDistance(a);
            const bCenter = this.getViewportCenterDistance(b);
            if (aCenter !== bCenter) return aCenter - bCenter;
        }

        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const aWidth = Math.max(aRect.width, a.naturalWidth || 0, a.videoWidth || 0, a.clientWidth || 0);
        const aHeight = Math.max(aRect.height, a.naturalHeight || 0, a.videoHeight || 0, a.clientHeight || 0);
        const bWidth = Math.max(bRect.width, b.naturalWidth || 0, b.videoWidth || 0, b.clientWidth || 0);
        const bHeight = Math.max(bRect.height, b.naturalHeight || 0, b.videoHeight || 0, b.clientHeight || 0);
        return (bWidth * bHeight) - (aWidth * aHeight);
    }

    getViewportCenterDistance(element) {
        if (!(element instanceof Element)) return Number.MAX_SAFE_INTEGER;
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const viewportX = window.innerWidth / 2;
        const viewportY = window.innerHeight / 2;
        return Math.abs(centerX - viewportX) + Math.abs(centerY - viewportY);
    }

    hasDetailContainerAncestor(element) {
        return Boolean(
            element.closest('[role="dialog"], [aria-modal="true"], [data-testid*="detail"], [class*="detail"], [class*="modal"], [class*="dialog"], [class*="drawer"]')
        );
    }

    hasFixedOverlayAncestor(element) {
        let node = element.parentElement;
        for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
            const style = window.getComputedStyle(node);
            if (style.position === 'fixed' || style.position === 'sticky') return true;
        }
        return false;
    }

    isLikelyMainImage(img) {
        const rect = img.getBoundingClientRect();
        const width = Math.max(rect.width, img.naturalWidth || 0, img.width || 0);
        const height = Math.max(rect.height, img.naturalHeight || 0, img.height || 0);
        if (width < 220 || height < 220) return false;
        if (!img.offsetParent && rect.width === 0 && rect.height === 0) return false;
        return true;
    }

    isLikelyMainVideo(video) {
        const rect = video.getBoundingClientRect();
        const width = Math.max(rect.width, video.videoWidth || 0, video.clientWidth || 0);
        const height = Math.max(rect.height, video.videoHeight || 0, video.clientHeight || 0);
        if (width < 260 || height < 160) return false;
        if (!video.offsetParent && rect.width === 0 && rect.height === 0) return false;
        return true;
    }

    normalizeUrl(value) {
        if (!value || typeof value !== 'string') return null;
        if (value.startsWith('blob:') || value.startsWith('data:')) return null;
        try {
            return new URL(value, location.href).toString();
        } catch {
            return null;
        }
    }

    isValidMediaUrl(url, type) {
        if (!url) return false;
        const lower = url.toLowerCase();
        if (type === 'video') {
            if (/\.(mp4|mov|webm|m3u8)(\?|$)/.test(lower)) return true;
            if (lower.includes('/video/')) return true;
            if (/(?:tos-cn-v-|tos-cn-ve-)/.test(lower)) return true;
            if (/(?:\?|&)(?:mime_type|mimetype|media_type)=video/.test(lower)) return true;
            return false;
        }
        return /\.(jpg|jpeg|png|webp|gif|bmp)(\?|$)/.test(lower) || lower.includes('/image/');
    }

    extractAssetKey(url) {
        if (!url) return null;
        try {
            const leaf = (new URL(url)).pathname.split('/').pop() || '';
            const withoutVariant = leaf.split('~tplv-')[0];
            return withoutVariant.replace(/\.[^.]+$/, '') || null;
        } catch {
            return null;
        }
    }

    hash(value) {
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
            hash = (hash << 5) - hash + value.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }
}

new JimengMediaCollector();



