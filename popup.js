const FLOATING_DOWNLOAD_KEY = 'floatingDownloadEnabled';

function getQualityLabel(source, url) {
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

class PopupManager {
    constructor() {
        this.currentTab = null;
        this.mediaItems = [];
        this.floatingDownloadEnabled = true;
        this.init();
    }

    async init() {
        await this.getCurrentTab();
        await this.loadSettings();
        this.bindEvents();
        await this.refreshStatus();
    }

    async loadSettings() {
        const data = await chrome.storage.local.get([FLOATING_DOWNLOAD_KEY]);
        this.floatingDownloadEnabled = data[FLOATING_DOWNLOAD_KEY] !== false;
        this.renderFloatingDownloadToggle();
    }

    async getCurrentTab() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        this.currentTab = tab || null;
    }

    bindEvents() {
        document.getElementById('primaryDownloadBtn')?.addEventListener('click', () => {
            if (this.mediaItems.length === 1) {
                this.downloadItem(this.mediaItems[0], document.getElementById('primaryDownloadBtn'));
            }
        });
        document.getElementById('tabDownloadBtn')?.addEventListener('click', () => {
            if (this.mediaItems.length === 1) {
                this.downloadItemWithTab(this.mediaItems[0], document.getElementById('tabDownloadBtn'));
            }
        });
        document.getElementById('floatingDownloadToggle')?.addEventListener('change', async (event) => {
            await this.updateFloatingDownloadSetting(Boolean(event.target.checked));
        });
        document.querySelectorAll('[data-url]').forEach((el) => {
            el.addEventListener('click', () => this.openUrl(el.getAttribute('data-url')));
        });
    }

    async updateFloatingDownloadSetting(enabled) {
        this.floatingDownloadEnabled = enabled;
        this.renderFloatingDownloadToggle();
        await chrome.storage.local.set({ [FLOATING_DOWNLOAD_KEY]: enabled });
        await this.notifyCurrentTabFloatingDownload(enabled);
    }

    isSupportedHost(url) {
        return typeof url === 'string' && (
            url.includes('jimeng.jianying.com') ||
            url.includes('dreamina.capcut.com')
        );
    }

    renderFloatingDownloadToggle() {
        const toggleEl = document.getElementById('floatingDownloadToggle');
        if (toggleEl) toggleEl.checked = this.floatingDownloadEnabled;
    }

    async notifyCurrentTabFloatingDownload(enabled) {
        if (!this.currentTab?.id) return;
        if (!this.isSupportedHost(this.currentTab.url)) return;
        try {
            await chrome.tabs.sendMessage(this.currentTab.id, {
                action: 'setFloatingDownloadEnabled',
                enabled
            });
        } catch {}
    }

    openUrl(url) {
        if (!url) return;
        chrome.tabs.create({ url });
    }

    async refreshStatus() {
        if (!this.currentTab?.id) {
            this.renderUnsupported('无法识别当前标签页');
            return;
        }

        if (!this.isSupportedHost(this.currentTab.url)) {
            this.renderUnsupported('当前页面不是即梦或 Dreamina');
            return;
        }

        try {
            const response = await chrome.tabs.sendMessage(this.currentTab.id, { action: 'getStatus' });
            if (!response?.success) {
                const errorText = response?.error ? `页面脚本异常：${response.error}` : '页面脚本未响应';
                this.renderUnsupported(errorText);
                return;
            }

            if (!response.supported) {
                const site = (this.currentTab?.url || '').includes('dreamina.capcut.com') ? 'Dreamina' : '即梦';
                this.renderUnsupported(`当前页面不是${site}详情页`);
                return;
            }

            this.mediaItems = response.mediaItems || [];
            if (typeof response.floatingDownloadEnabled === 'boolean' && response.floatingDownloadEnabled !== this.floatingDownloadEnabled) {
                this.floatingDownloadEnabled = response.floatingDownloadEnabled;
                this.renderFloatingDownloadToggle();
            }
            this.renderStatus(response);
        } catch {
            this.renderUnsupported('页面脚本未响应');
        }
    }

    renderUnsupported(message) {
        this.mediaItems = [];
        this.renderHeader(message, false);
        this.renderPrimaryAction([]);
        this.renderList([]);
    }

    renderStatus(data) {
        const url = data.pageUrl || this.currentTab?.url || '';
        const site = url.includes('dreamina.capcut.com') ? 'Dreamina' : '即梦';
        const mediaLabel = data.pageStrategy === 'video' ? '视频' : '图片';
        const pageType = `${site}${mediaLabel}详情页`;
        const mediaItems = data.mediaItems || [];
        this.renderHeader(pageType, true);
        this.renderPrimaryAction(mediaItems);
        this.renderList(mediaItems);
    }

    renderHeader(status, active) {
        const statusEl = document.getElementById('pluginStatus');
        const indicatorEl = document.getElementById('statusIndicator');

        if (statusEl) statusEl.textContent = status;
        if (indicatorEl) indicatorEl.className = `status-indicator ${active ? 'status-active' : 'status-inactive'}`;
    }

    renderPrimaryAction(mediaItems) {
        const wrapEl = document.getElementById('primaryActionWrap');
        const buttonEl = document.getElementById('primaryDownloadBtn');
        const tabButtonEl = document.getElementById('tabDownloadBtn');
        if (!wrapEl || !buttonEl) return;

        if (mediaItems.length !== 1) {
            wrapEl.classList.add('hidden');
            buttonEl.disabled = false;
            buttonEl.textContent = '去水印下载';
            if (tabButtonEl) {
                tabButtonEl.disabled = false;
                tabButtonEl.textContent = '弹tab解析下载';
            }
            return;
        }

        const item = mediaItems[0];
        const jimengUrl = this.currentTab?.url || '';
        const isJimengDetail = jimengUrl.includes('jimeng.jianying.com')
            && (item.type === 'image' || item.type === 'video')
            && !jimengUrl.includes('/ai-tool/generate') && !jimengUrl.includes('/ai-tool/canvas');

        wrapEl.classList.remove('hidden');
        buttonEl.disabled = false;
        buttonEl.textContent = isJimengDetail
            ? '快速去水印下载'
            : (item.type === 'video' ? '去水印下载视频' : '去水印下载图片');

        if (tabButtonEl) {
            if (isJimengDetail) {
                tabButtonEl.style.display = 'block';
                tabButtonEl.disabled = false;
                tabButtonEl.textContent = '原画解析下载';
            } else {
                tabButtonEl.style.display = 'none';
            }
        }

        let hintEl = wrapEl.querySelector('.tab-hint');
        if (isJimengDetail) {
            if (!hintEl) {
                hintEl = document.createElement('div');
                hintEl.className = 'tab-hint';
                hintEl.textContent = '原画解析会自动弹标签页，解析完成自动关闭';
                wrapEl.appendChild(hintEl);
            }
            hintEl.style.display = 'block';
        } else if (hintEl) {
            hintEl.style.display = 'none';
        }
    }

    renderList(mediaItems) {
        const listEl = document.getElementById('mediaList');
        const emptyEl = document.getElementById('emptyState');
        if (!listEl || !emptyEl) return;

        listEl.innerHTML = '';
        if (!mediaItems.length) {
            emptyEl.classList.remove('hidden');
            return;
        }

        emptyEl.classList.add('hidden');

        mediaItems.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'media-item';

            const meta = document.createElement('div');
            meta.className = 'media-meta';

            const title = document.createElement('div');
            title.className = 'media-title';
            title.textContent = item.type === 'video' ? '视频' : '图片';

            const filename = document.createElement('div');
            filename.className = 'media-url';
            filename.textContent = (item.filename || '').replace(/\.[^.]+$/, '');

            const source = document.createElement('div');
            source.className = 'media-source';
            const qualityLabel = getQualityLabel(item.source, item.url);
            const isJimengSpa = this.currentTab?.url?.includes('jimeng.jianying.com')
                && !this.currentTab?.url?.includes('/ai-tool/generate')
                && !this.currentTab?.url?.includes('/ai-tool/canvas');
            const needOriginalHint = isJimengSpa && qualityLabel && qualityLabel !== '原图' && qualityLabel !== '原画视频' && qualityLabel !== '高清原图';
            source.textContent = qualityLabel
                ? `资源级别：${qualityLabel}${needOriginalHint ? '（原画解析可获得原始画质资源）' : ''}`
                : item.source;

            meta.appendChild(title);
            meta.appendChild(filename);
            meta.appendChild(source);

            row.appendChild(meta);

            if (mediaItems.length > 1) {
                const button = document.createElement('button');
                button.className = 'media-download-btn';
                button.textContent = '去水印下载';
                button.addEventListener('click', () => this.downloadItem(item, button));
                row.appendChild(button);
            }

            listEl.appendChild(row);
        });
    }

    async downloadItem(item, button) {
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '下载中';

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'downloadFile',
                url: item.url,
                filename: item.filename,
                mediaType: item.type,
                source: item.source,
                extraImageCandidates: item.type === 'image' ? (item.extraImageCandidates || []) : [],
                preferBlob: false,
                pageUrl: this.currentTab?.url || ''
            });

            if (!response?.success) {
                throw new Error(response?.error || '下载失败');
            }

            button.textContent = '已开始';
        } catch (error) {
            button.textContent = error?.message ? `失败：${error.message.slice(0, 12)}` : '下载失败';
        }

        setTimeout(() => {
            button.disabled = false;
            button.textContent = originalText;
            this.renderPrimaryAction(this.mediaItems);
        }, 1500);
    }

    async downloadItemWithTab(item, button) {
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '弹tab解析中...';

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'downloadWithTab',
                detailUrl: this.currentTab?.url || '',
                pageUrl: this.currentTab?.url || ''
            });

            if (!response?.success) {
                throw new Error(response?.error || '弹tab解析失败');
            }

            button.textContent = '已开始';
        } catch (error) {
            button.textContent = error?.message ? `失败：${error.message.slice(0, 12)}` : '解析失败';
        }

        setTimeout(() => {
            button.disabled = false;
            button.textContent = originalText;
            this.renderPrimaryAction(this.mediaItems);
        }, 1500);
    }

}

document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});
