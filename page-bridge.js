// 运行在页面主世界，负责把单页应用路由变化和当前详情数据通知给 content script。
(() => {
    if (window.__jimengParserBridgeInstalled) return;
    window.__jimengParserBridgeInstalled = true;

    const navigationType = 'jimeng-page-change';
    const workDetailType = 'jimeng-work-detail';
    const debugEnabled = false;
    let lastUrl = location.href;
    let lastWorkDetailSignature = '';
    let snapshotTimer = 0;

    const debug = (event, details = {}) => {
        if (!debugEnabled) return;
        console.debug('[seedance-bridge]', event, {
            ...details,
            href: location.href,
            ts: Date.now()
        });
    };

    const isJimengApiUrl = (value) => {
        if (!value || typeof value !== 'string') return false;
        try {
            const parsed = new URL(value, location.href);
            return parsed.hostname.includes('jimeng.jianying.com') && parsed.pathname.includes('/mweb/v1/mget_item_info');
        } catch {
            return false;
        }
    };

    const shouldInspectJsonResponseUrl = (value) => {
        if (!value || typeof value !== 'string') return false;
        try {
            const parsed = new URL(value, location.href);
            return parsed.hostname.includes('jimeng.jianying.com') && parsed.pathname.includes('/mweb/');
        } catch {
            return false;
        }
    };

    const parseJsonPayload = (value) => {
        if (!value) return null;
        if (typeof value === 'object') return value;
        if (typeof value !== 'string') return null;
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    };

    const getPublishedItemId = (url = location.href) => {
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
            return queryId && /^\d+$/.test(queryId) ? queryId : '';
        } catch {
            return '';
        }
    };

    const normalizeUrl = (value) => {
        if (!value || typeof value !== 'string') return null;
        if (value.startsWith('blob:') || value.startsWith('data:')) return null;
        try {
            return new URL(value, location.href).toString();
        } catch {
            return null;
        }
    };

    const extractAssetKey = (url) => {
        if (!url) return '';
        try {
            const leaf = (new URL(url)).pathname.split('/').pop() || '';
            const withoutVariant = leaf.split('~tplv-')[0];
            return withoutVariant.replace(/\.[^.]+$/, '') || '';
        } catch {
            return '';
        }
    };

    const describeVideoUrl = (url) => {
        try {
            const parsed = new URL(url);
            const segments = parsed.pathname.split('/').filter(Boolean);
            const groupKey = segments.length >= 3 && segments[2] === 'video' && segments[1]
                ? `video:${segments[1]}`
                : `video:${parsed.pathname}`;
            return { groupKey };
        } catch {
            return { groupKey: '' };
        }
    };

    const getWorkDetailIdCandidates = (workDetail) => [
        workDetail?.publishedItemId,
        workDetail?.published_item_id,
        workDetail?.itemId,
        workDetail?.item_id,
        workDetail?.effectId,
        workDetail?.effect_id,
        workDetail?.id,
        workDetail?.value?.publishedItemId,
        workDetail?.value?.published_item_id,
        workDetail?.value?.itemId,
        workDetail?.value?.item_id,
        workDetail?.value?.effectId,
        workDetail?.value?.effect_id,
        workDetail?.value?.id,
        workDetail?.item?.publishedItemId,
        workDetail?.item?.published_item_id,
        workDetail?.item?.itemId,
        workDetail?.item?.item_id,
        workDetail?.item?.effectId,
        workDetail?.item?.effect_id,
        workDetail?.item?.id
    ].filter(Boolean).map((value) => String(value));

    const looksLikeWorkDetail = (value) => Boolean(
        value
        && typeof value === 'object'
        && (
            value.image
            || value.effectImage
            || value.video
            || value.videoInfo
            || value.video_info
            || value.commonAttr
            || value.common_attr
        )
    );

    const isMatchingWorkDetail = (workDetail, targetId = getPublishedItemId()) => {
        if (!workDetail || typeof workDetail !== 'object') return false;
        if (!targetId) return looksLikeWorkDetail(workDetail);
        return getWorkDetailIdCandidates(workDetail).includes(String(targetId));
    };

    const findWorkDetailDeep = (payload) => {
        if (!payload || typeof payload !== 'object') return null;

        const targetId = getPublishedItemId();
        const seen = new Set();
        const stack = [payload];
        let fallback = null;

        while (stack.length) {
            const current = stack.pop();
            if (!current || typeof current !== 'object' || seen.has(current)) continue;
            seen.add(current);

            const candidate = current?.workDetail?.value || current?.workDetail || null;
            if (candidate && typeof candidate === 'object') {
                if (isMatchingWorkDetail(candidate, targetId)) return candidate;
                if (!fallback) fallback = candidate;
            }

            if (looksLikeWorkDetail(current)) {
                if (isMatchingWorkDetail(current, targetId)) return current;
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
    };

    const readRouterPayload = () => {
        if (window._ROUTER_DATA && typeof window._ROUTER_DATA === 'object') {
            return window._ROUTER_DATA;
        }
        return null;
    };

    const getPrimaryImageUrl = (workDetail) => {
        const imageInfo = workDetail?.image || workDetail?.effectImage || workDetail?.value?.image || null;
        const commonAttr = workDetail?.commonAttr || workDetail?.common_attr || workDetail?.value?.commonAttr || workDetail?.value?.common_attr || null;
        const largeImages = imageInfo?.largeImages || imageInfo?.large_images || [];
        if (Array.isArray(largeImages)) {
            for (const item of largeImages) {
                const url = normalizeUrl(item?.imageUrl || item?.image_url);
                if (url) return url;
            }
        }
        const coverUrlMap = commonAttr?.coverUrlMap || commonAttr?.cover_url_map || null;
        if (coverUrlMap && typeof coverUrlMap === 'object') {
            const values = Object.entries(coverUrlMap)
                .sort((a, b) => Number(b[0] || 0) - Number(a[0] || 0))
                .map(([, url]) => normalizeUrl(url))
                .filter(Boolean);
            if (values[0]) return values[0];
        }
        return normalizeUrl(commonAttr?.coverUrl || commonAttr?.cover_url || '');
    };

    const getPrimaryVideoUrl = (workDetail) => {
        const videoInfo = workDetail?.video
            || workDetail?.videoInfo
            || workDetail?.video_info
            || workDetail?.value?.video
            || workDetail?.value?.videoInfo
            || workDetail?.value?.video_info
            || workDetail?.item?.video
            || workDetail?.item?.videoInfo
            || workDetail?.item?.video_info
            || null;
        const commonAttr = workDetail?.commonAttr
            || workDetail?.common_attr
            || workDetail?.value?.commonAttr
            || workDetail?.value?.common_attr
            || workDetail?.item?.commonAttr
            || workDetail?.item?.common_attr
            || null;

        const direct = [
            videoInfo?.originVideo?.videoUrl,
            videoInfo?.originVideo?.video_url,
            videoInfo?.originVideoUrl,
            videoInfo?.origin_video_url
        ].map((value) => normalizeUrl(value)).find(Boolean);
        if (direct) return direct;

        const transcoded = videoInfo?.transcodedVideo || videoInfo?.transcoded_video || null;
        if (transcoded && typeof transcoded === 'object') {
            const values = Object.values(transcoded)
                .map((item) => normalizeUrl(item?.videoUrl || item?.video_url || item?.url))
                .filter(Boolean);
            if (values[0]) return values[0];
        }

        const playAddr = videoInfo?.playAddr || videoInfo?.play_addr || null;
        const playAddrUrl = [
            ...(Array.isArray(playAddr?.urlList) ? playAddr.urlList : []),
            ...(Array.isArray(playAddr?.url_list) ? playAddr.url_list : []),
            ...(Array.isArray(playAddr?.urls) ? playAddr.urls : []),
            playAddr?.url,
            playAddr?.mainUrl
        ].map((value) => normalizeUrl(value)).find(Boolean);
        if (playAddrUrl) return playAddrUrl;

        const itemUrls = [
            ...(Array.isArray(commonAttr?.itemUrls) ? commonAttr.itemUrls : []),
            ...(Array.isArray(commonAttr?.item_urls) ? commonAttr.item_urls : []),
            ...(Array.isArray(workDetail?.itemUrls) ? workDetail.itemUrls : []),
            ...(Array.isArray(workDetail?.item_urls) ? workDetail.item_urls : [])
        ].map((value) => normalizeUrl(value)).find(Boolean);
        if (itemUrls) return itemUrls;

        return normalizeUrl(videoInfo?.videoUrl || videoInfo?.video_url || videoInfo?.url || '');
    };

    const getWorkDetailPrimaryMediaKey = (workDetail) => {
        const imageUrl = getPrimaryImageUrl(workDetail);
        const imageKey = extractAssetKey(imageUrl);
        if (imageKey) return imageKey;
        if (imageUrl) return imageUrl;

        const videoUrl = getPrimaryVideoUrl(workDetail);
        const videoKey = describeVideoUrl(videoUrl).groupKey;
        return videoKey || videoUrl || '';
    };

    const buildWorkDetailSignature = (workDetail) => {
        const itemId = getWorkDetailIdCandidates(workDetail)[0] || '';
        const imageKey = extractAssetKey(getPrimaryImageUrl(workDetail));
        const videoKey = describeVideoUrl(getPrimaryVideoUrl(workDetail)).groupKey;
        return [location.href, itemId, imageKey, videoKey].join('|');
    };

    const buildWorkDetailEnvelope = (workDetail, sourceKind = 'router') => ({
        type: workDetailType,
        url: location.href,
        workDetail,
        publishedItemId: getWorkDetailIdCandidates(workDetail)[0] || '',
        detailMediaKey: getWorkDetailPrimaryMediaKey(workDetail),
        sourceKind,
        capturedAt: Date.now(),
        signature: buildWorkDetailSignature(workDetail)
    });

    const publishWorkDetail = ({ force = false, workDetailOverride = null, sourceKind = 'router', allowFallback = false } = {}) => {
        const workDetail = workDetailOverride && typeof workDetailOverride === 'object'
            ? workDetailOverride
            : findWorkDetailDeep(readRouterPayload());
        if (!workDetail) return;

        const targetId = getPublishedItemId();
        if (targetId && !isMatchingWorkDetail(workDetail, targetId) && !allowFallback) {
            debug('skip-bridge-publish-mismatch', {
                sourceKind,
                targetId,
                candidateIds: getWorkDetailIdCandidates(workDetail)
            });
            return;
        }

        const envelope = buildWorkDetailEnvelope(workDetail, sourceKind);
        if (!force && envelope.signature && envelope.signature === lastWorkDetailSignature) return;
        lastWorkDetailSignature = envelope.signature;
        debug('publish-work-detail', {
            sourceKind,
            publishedItemId: envelope.publishedItemId,
            detailMediaKey: envelope.detailMediaKey,
            signature: envelope.signature
        });
        window.postMessage(envelope, '*');
    };

    const scheduleSnapshot = (delay = 80) => {
        clearTimeout(snapshotTimer);
        snapshotTimer = setTimeout(() => {
            snapshotTimer = 0;
            publishWorkDetail();
        }, delay);
    };

    const burstSnapshot = () => {
        [0, 60, 180, 400, 900].forEach((delay, index) => {
            setTimeout(() => publishWorkDetail({ force: index === 0 }), delay);
        });
    };

    const publishPayloadWorkDetail = (payload, sourceKind = 'bridge-api') => {
        if (!payload || typeof payload !== 'object') return;

        const candidates = [];
        const pushCandidate = (value) => {
            if (value && typeof value === 'object') candidates.push(value);
        };

        const data = payload?.data && typeof payload.data === 'object' ? payload.data : null;
        if (data) {
            if (Array.isArray(data.effect_item_list)) candidates.push(...data.effect_item_list);
            if (Array.isArray(data.item_list)) candidates.push(...data.item_list);
            pushCandidate(data.work_detail);
            pushCandidate(data.item);
            pushCandidate(data);
        }

        pushCandidate(payload?.loaderData?.['ai-tool/work-detail/(id$)/page']?.workDetail?.value);
        pushCandidate(payload?.loaderData?.['ai-tool/work-detail/(id$)/page']?.workDetail);
        pushCandidate(payload?.loaderData?.['ai-tool/image/(id$)/page']?.workDetail?.value);
        pushCandidate(payload?.loaderData?.['ai-tool/image/(id$)/page']?.workDetail);
        pushCandidate(payload?.loaderData?.['ai-tool/video/(id$)/page']?.workDetail?.value);
        pushCandidate(payload?.loaderData?.['ai-tool/video/(id$)/page']?.workDetail);
        pushCandidate(payload);

        const targetId = getPublishedItemId();
        const workDetail = candidates.find((candidate) => isMatchingWorkDetail(candidate, targetId))
            || candidates.find((candidate) => looksLikeWorkDetail(candidate) && (!targetId || isMatchingWorkDetail(candidate, targetId)))
            || findWorkDetailDeep(data || payload);
        if (!workDetail) return;

        debug('publish-payload-work-detail', {
            sourceKind,
            targetId,
            candidateIds: getWorkDetailIdCandidates(workDetail)
        });
        publishWorkDetail({ force: true, workDetailOverride: workDetail, sourceKind, allowFallback: false });
    };

    const publishApiWorkDetail = (payload) => {
        publishPayloadWorkDetail(payload, 'bridge-api');
    };

    const interceptJsonResponse = async (responsePromise, url) => {
        try {
            const response = await responsePromise;
            if (!response || !shouldInspectJsonResponseUrl(url)) return response;
            response.clone().json()
                .then((payload) => publishPayloadWorkDetail(payload, isJimengApiUrl(url) ? 'bridge-api' : 'bridge-json'))
                .catch(() => {});
            return response;
        } catch (error) {
            throw error;
        }
    };

    const installRouterDataHook = () => {
        let storedValue = window._ROUTER_DATA;

        try {
            const descriptor = Object.getOwnPropertyDescriptor(window, '_ROUTER_DATA');
            if (descriptor && descriptor.configurable === false) {
                queueMicrotask(() => publishPayloadWorkDetail(window._ROUTER_DATA, 'bridge-router'));
                return;
            }

            const originalGet = descriptor?.get;
            const originalSet = descriptor?.set;
            const readValue = () => originalGet ? originalGet.call(window) : storedValue;

            Object.defineProperty(window, '_ROUTER_DATA', {
                configurable: true,
                enumerable: descriptor?.enumerable ?? true,
                get() {
                    return originalGet ? originalGet.call(this) : storedValue;
                },
                set(value) {
                    if (originalSet) {
                        originalSet.call(this, value);
                    } else {
                        storedValue = value;
                    }
                    queueMicrotask(() => publishPayloadWorkDetail(readValue(), 'bridge-router'));
                }
            });

            const currentValue = readValue();
            if (currentValue && typeof currentValue === 'object') {
                queueMicrotask(() => publishPayloadWorkDetail(currentValue, 'bridge-router'));
            }
        } catch {
        }
    };

    const notifyNavigation = () => {
        if (location.href === lastUrl) return;
        const previousUrl = lastUrl;
        lastUrl = location.href;
        lastWorkDetailSignature = '';
        debug('navigation', {
            previousUrl,
            nextUrl: lastUrl,
            publishedItemId: getPublishedItemId(lastUrl)
        });
        window.postMessage({ type: navigationType, url: lastUrl }, '*');
        burstSnapshot();
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    const originalFetch = window.fetch;
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    history.pushState = function(...args) {
        const result = originalPushState.apply(this, args);
        queueMicrotask(notifyNavigation);
        return result;
    };

    history.replaceState = function(...args) {
        const result = originalReplaceState.apply(this, args);
        queueMicrotask(notifyNavigation);
        return result;
    };

    window.fetch = function(...args) {
        const request = args[0];
        const requestUrl = typeof request === 'string'
            ? request
            : request?.url || '';
        const result = originalFetch.apply(this, args);
        if (!shouldInspectJsonResponseUrl(requestUrl)) return result;
        return interceptJsonResponse(result, requestUrl);
    };

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__jimengBridgeUrl = typeof url === 'string' ? url : '';
        return originalXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(body) {
        this.addEventListener('load', () => {
            if (!isJimengApiUrl(this.__jimengBridgeUrl)) return;
            const payload = parseJsonPayload(this.responseType && this.responseType !== 'text' ? this.response : this.responseText);
            if (payload) publishApiWorkDetail(payload);
        });
        return originalXhrSend.call(this, body);
    };

    installRouterDataHook();

    window.addEventListener('popstate', notifyNavigation, true);
    window.addEventListener('hashchange', notifyNavigation, true);
    document.addEventListener('load', () => scheduleSnapshot(30), true);

    const observer = new MutationObserver(() => {
        scheduleSnapshot(120);
    });

    observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'poster', 'style', 'class', 'data-src', 'data-original']
    });

    burstSnapshot();
})();
